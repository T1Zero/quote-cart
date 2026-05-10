import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  validateIncomingQuote,
  persistQuote,
  calculateQuoteValue,
  type IncomingQuote,
} from "../lib/quote.server";
import { sendQuoteEmails } from "../lib/email.server";
import { fireServerSideEvents } from "../lib/tracking.server";
import { generateEventId } from "../lib/crypto.server";
import {
  createDraftOrderFromQuote,
  getOrInitOrderSettings,
} from "../lib/draftOrder.server";
import {
  listCustomFields,
  saveValuesForQuote,
  validateAndCollectValues,
} from "../lib/customField.server";

/**
 * App Proxy submission endpoint: POST /apps/quote/submit
 *
 * Accepts a JSON body with the quote payload.
 * 1. Validates input
 * 2. Persists Quote + QuoteItem rows
 * 3. Sends customer + merchant emails (best-effort)
 * 4. Fires server-side conversion events (best-effort)
 * 5. Returns success payload with shared `event_id` so the client can dedupe
 *
 * Email + tracking failures NEVER block the user-facing success state — they
 * are logged for the admin to inspect.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  const proxy = await authenticate.public.appProxy(request);
  const shopDomain = proxy.session?.shop || "";
  if (!shopDomain) {
    return json({ ok: false, error: "Unauthenticated" }, { status: 401 });
  }

  let body: Partial<IncomingQuote> & {
    currency?: string;
    gclid?: string | null;
    fbp?: string;
    fbc?: string;
    ga?: string;
    pageUrl?: string;
    customFields?: Record<string, string>;
  };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const incoming: IncomingQuote = {
    customerName: String(body.customerName || ""),
    customerEmail: String(body.customerEmail || ""),
    customerPhone: String(body.customerPhone || ""),
    message: String(body.message || ""),
    items: Array.isArray(body.items) ? body.items : [],
  };
  const errors = validateIncomingQuote(incoming);
  if (errors.length > 0) {
    return json(
      { ok: false, error: errors.map((e) => e.message).join(" "), fieldErrors: errors },
      { status: 400 },
    );
  }

  // Validate custom-field answers against the merchant's current field config.
  const customFields = await listCustomFields(shopDomain);
  const incomingCustom: Record<string, string> = {};
  if (body.customFields && typeof body.customFields === "object") {
    for (const [k, v] of Object.entries(body.customFields)) {
      if (typeof v === "string") incomingCustom[k] = v;
    }
  }
  const customValidation = validateAndCollectValues(customFields, incomingCustom);
  if (!customValidation.ok) {
    return json(
      {
        ok: false,
        error: customValidation.errors.map((e) => e.message).join(" "),
        fieldErrors: customValidation.errors,
      },
      { status: 400 },
    );
  }

  const quote = await persistQuote(shopDomain, incoming);
  if (customValidation.values.length > 0) {
    await saveValuesForQuote(quote.id, customValidation.values);
  }
  const value = calculateQuoteValue(quote.items);
  const currency = (body.currency || "USD").toUpperCase();
  const eventId = generateEventId();

  const ip = clientIp(request);
  const ua = request.headers.get("user-agent") || "";

  // Read order settings before kicking off background work so we can decide
  // whether to auto-create a Shopify draft order.
  const orderSettings = await getOrInitOrderSettings(shopDomain);
  const shouldAutoCreateDraft = orderSettings.autoCreateDraft;

  // Fire-and-forget side effects: emails, server-side tracking, draft order.
  // Shopify's App Proxy enforces a ~30s hard timeout. If SMTP misconfig or
  // a slow tracking platform keeps these awaited too long, the customer sees
  // "Request timed out". Instead, persist the quote synchronously and let the
  // side effects complete in the background — failures show up in the admin
  // (TrackingEvent rows / quote detail) rather than blocking the user.
  const trackingCtx = {
    eventId,
    eventSourceUrl: body.pageUrl || `https://${shopDomain}/apps/quote`,
    clientIp: ip,
    userAgent: ua,
    fbp: body.fbp || undefined,
    fbc: body.fbc || undefined,
    ga: body.ga || undefined,
    gclid: body.gclid || undefined,
    currency,
    value,
  };
  void runBackgroundSideEffects({
    quote,
    shopDomain,
    trackingCtx,
    shouldAutoCreateDraft,
  });

  // Build the response. The client uses `event_id` to dedupe its
  // own pixel/gtag fires against the server-side ones.
  return json({
    ok: true,
    quote_id: quote.id,
    event_id: eventId,
    value,
    currency,
    item_count: quote.items.reduce((s, i) => s + i.quantity, 0),
    items: quote.items.map((i) => ({
      id: i.variantId,
      name: i.productTitle,
      quantity: i.quantity,
      price: parseFloat(i.price) || 0,
    })),
  });
};

async function runBackgroundSideEffects(args: {
  quote: Awaited<ReturnType<typeof persistQuote>>;
  shopDomain: string;
  trackingCtx: Parameters<typeof fireServerSideEvents>[1];
  shouldAutoCreateDraft: boolean;
}) {
  const { quote, shopDomain, trackingCtx, shouldAutoCreateDraft } = args;
  await Promise.allSettled([
    sendQuoteEmails(quote, shopDomain).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[QuoteCart] sendQuoteEmails failed", err);
    }),
    fireServerSideEvents(quote, trackingCtx, shopDomain).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[QuoteCart] fireServerSideEvents failed", err);
    }),
    shouldAutoCreateDraft
      ? createDraftOrderFromQuote(shopDomain, quote).catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[QuoteCart] createDraftOrderFromQuote failed", err);
        })
      : Promise.resolve(null),
  ]);
}

// Loader for non-POST hits — e.g., merchants browsing to it directly.
export const loader = () =>
  json({ ok: false, error: "Method not allowed" }, { status: 405 });

function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return "0.0.0.0";
}
