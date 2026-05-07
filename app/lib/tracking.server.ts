import type { TrackingSettings } from "@prisma/client";
import prisma from "../db.server";
import { decryptSecret, sha256Hex } from "./crypto.server";
import type { QuoteWithItems } from "./email.server";

export type TrackingContext = {
  eventId: string;
  eventSourceUrl: string;
  clientIp: string;
  userAgent: string;
  fbp?: string;
  fbc?: string;
  ga?: string;
  gclid?: string;
  currency: string;
  value: number;
};

export async function getOrInitTrackingSettings(shopDomain: string): Promise<TrackingSettings> {
  const existing = await prisma.trackingSettings.findUnique({ where: { shopDomain } });
  if (existing) return existing;
  return prisma.trackingSettings.create({
    data: { shopDomain },
  });
}

export type ServerEventResult = {
  platform: "meta_capi" | "ga4" | "google_ads";
  status: "success" | "failed";
  errorMessage: string | null;
  eventId: string;
  payload: unknown;
};

export async function fireServerSideEvents(
  quote: QuoteWithItems,
  ctx: TrackingContext,
  shopDomain: string,
): Promise<ServerEventResult[]> {
  const settings = await getOrInitTrackingSettings(shopDomain);
  if (!settings.serverTrackingEnabled) return [];

  const tasks: Promise<ServerEventResult>[] = [];

  if (settings.metaPixelId) {
    tasks.push(fireMetaCapi(settings, quote, ctx));
  }
  if (settings.ga4MeasurementId) {
    tasks.push(fireGA4(settings, quote, ctx));
  }
  if (settings.googleAdsConversionId) {
    tasks.push(fireGoogleAds(settings, quote, ctx));
  }

  const results = await Promise.all(tasks);

  // Persist each event so the admin Quote detail page can show pass/fail status.
  await prisma.$transaction(
    results.map((r) =>
      prisma.trackingEvent.create({
        data: {
          quoteId: quote.id,
          platform: r.platform,
          status: r.status,
          errorMessage: r.errorMessage,
          eventId: r.eventId,
          payload: JSON.stringify(r.payload ?? {}),
        },
      }),
    ),
  );

  return results;
}

async function fireMetaCapi(
  settings: TrackingSettings,
  quote: QuoteWithItems,
  ctx: TrackingContext,
): Promise<ServerEventResult> {
  const token = decryptSecret(settings.metaCapiTokenEncrypted);
  if (!token) {
    return mkFail("meta_capi", ctx.eventId, "Meta CAPI token not configured");
  }
  const userData: Record<string, unknown> = {
    em: [sha256Hex(quote.customerEmail)],
    ph: [sha256Hex(normalizePhone(quote.customerPhone))],
    fn: [sha256Hex(firstName(quote.customerName))],
    ln: [sha256Hex(lastName(quote.customerName))],
    client_ip_address: ctx.clientIp,
    client_user_agent: ctx.userAgent,
  };
  if (ctx.fbp) userData.fbp = ctx.fbp;
  if (ctx.fbc) userData.fbc = ctx.fbc;

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(quote.createdAt.getTime() / 1000),
        event_id: ctx.eventId,
        action_source: "website",
        event_source_url: ctx.eventSourceUrl,
        user_data: userData,
        custom_data: {
          value: ctx.value,
          currency: ctx.currency,
          content_type: "product",
          content_ids: quote.items.map((i) => i.variantId),
          contents: quote.items.map((i) => ({
            id: i.variantId,
            quantity: i.quantity,
            item_price: parseFloat(i.price) || 0,
          })),
          num_items: quote.items.reduce((s, i) => s + i.quantity, 0),
        },
      },
    ],
  };
  if (settings.metaTestEventCode) {
    payload.test_event_code = settings.metaTestEventCode;
  }

  const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(settings.metaPixelId)}/events?access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      return mkFail("meta_capi", ctx.eventId, `HTTP ${res.status}: ${truncate(text, 500)}`, payload);
    }
    return { platform: "meta_capi", status: "success", errorMessage: null, eventId: ctx.eventId, payload };
  } catch (err) {
    return mkFail("meta_capi", ctx.eventId, err instanceof Error ? err.message : String(err), payload);
  }
}

async function fireGA4(
  settings: TrackingSettings,
  quote: QuoteWithItems,
  ctx: TrackingContext,
): Promise<ServerEventResult> {
  const apiSecret = decryptSecret(settings.ga4ApiSecretEncrypted);
  if (!apiSecret) {
    return mkFail("ga4", ctx.eventId, "GA4 API secret not configured");
  }
  // GA4 needs a stable client_id. Prefer the _ga cookie value; fall back to event_id.
  const clientId = ctx.ga ? extractGaClientId(ctx.ga) : ctx.eventId;
  const payload = {
    client_id: clientId,
    user_data: {
      sha256_email_address: sha256Hex(quote.customerEmail),
      sha256_phone_number: sha256Hex(normalizePhone(quote.customerPhone)),
    },
    events: [
      {
        name: "generate_lead",
        params: {
          currency: ctx.currency,
          value: ctx.value,
          // Custom param so it's visible in DebugView.
          quote_id: quote.id,
          item_count: quote.items.reduce((s, i) => s + i.quantity, 0),
          engagement_time_msec: 1,
          // GA4 caps at 200 items per event.
          items: quote.items.slice(0, 200).map((i) => ({
            item_id: i.variantId,
            item_name: i.productTitle,
            item_variant: i.variantTitle,
            price: parseFloat(i.price) || 0,
            quantity: i.quantity,
          })),
          event_id: ctx.eventId,
        },
      },
    ],
  };

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(settings.ga4MeasurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    // GA4 MP returns 204 on success and never returns a body for non-debug calls.
    if (!res.ok) {
      const text = await res.text();
      return mkFail("ga4", ctx.eventId, `HTTP ${res.status}: ${truncate(text, 500)}`, payload);
    }
    return { platform: "ga4", status: "success", errorMessage: null, eventId: ctx.eventId, payload };
  } catch (err) {
    return mkFail("ga4", ctx.eventId, err instanceof Error ? err.message : String(err), payload);
  }
}

async function fireGoogleAds(
  settings: TrackingSettings,
  quote: QuoteWithItems,
  ctx: TrackingContext,
): Promise<ServerEventResult> {
  // Google Ads Enhanced Conversions for web are submitted via the GA4 Measurement
  // Protocol when the GA4 property is linked to the Google Ads account, so we
  // ALSO fire a Google-Ads-flavored MP event here for accounts that don't run GA4.
  // If GA4 isn't configured, skip silently with a clear error so the merchant knows.
  const apiSecret = decryptSecret(settings.ga4ApiSecretEncrypted);
  if (!apiSecret || !settings.ga4MeasurementId) {
    return mkFail(
      "google_ads",
      ctx.eventId,
      "Google Ads enhanced conversions are sent through GA4 Measurement Protocol — configure GA4 first.",
    );
  }
  const clientId = ctx.ga ? extractGaClientId(ctx.ga) : ctx.eventId;
  const payload = {
    client_id: clientId,
    user_data: {
      sha256_email_address: sha256Hex(quote.customerEmail),
      sha256_phone_number: sha256Hex(normalizePhone(quote.customerPhone)),
    },
    events: [
      {
        name: "conversion",
        params: {
          send_to: `${settings.googleAdsConversionId}/${settings.googleAdsConversionLabel}`,
          value: ctx.value,
          currency: ctx.currency,
          gclid: ctx.gclid || undefined,
          transaction_id: quote.id,
          event_id: ctx.eventId,
        },
      },
    ],
  };
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(settings.ga4MeasurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      return mkFail("google_ads", ctx.eventId, `HTTP ${res.status}: ${truncate(text, 500)}`, payload);
    }
    return { platform: "google_ads", status: "success", errorMessage: null, eventId: ctx.eventId, payload };
  } catch (err) {
    return mkFail("google_ads", ctx.eventId, err instanceof Error ? err.message : String(err), payload);
  }
}

function mkFail(
  platform: ServerEventResult["platform"],
  eventId: string,
  errorMessage: string,
  payload?: unknown,
): ServerEventResult {
  return { platform, status: "failed", errorMessage, eventId, payload: payload ?? {} };
}

function normalizePhone(p: string): string {
  return p.replace(/[^0-9]/g, "");
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || "";
}

function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : "";
}

function extractGaClientId(ga: string): string {
  // Cookie format: GA1.1.<clientId-int>.<timestamp>
  const parts = ga.split(".");
  if (parts.length >= 4) return `${parts[2]}.${parts[3]}`;
  return ga;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
