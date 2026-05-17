import nodemailer, { type Transporter } from "nodemailer";
import type { EmailSettings } from "@prisma/client";
import prisma from "../db.server";
import { decryptSecret } from "./crypto.server";
import {
  DEFAULT_TEMPLATES,
  applyTemplate,
  buildTemplateVars,
  markdownToHtml,
  wrapEmailHtml,
  type QuoteWithItems,
} from "./email-templates";

// Re-export the client-safe pieces so existing imports keep working.
export {
  DEFAULT_TEMPLATES,
  TEMPLATE_VARIABLES,
  applyTemplate,
  buildItemsTable,
  buildPreview,
  buildTemplateVars,
  markdownToHtml,
  wrapEmailHtml,
  SAMPLE_QUOTE,
} from "./email-templates";
export type { QuoteWithItems, TemplateVariable } from "./email-templates";

// Make sure custom field values are loaded before rendering templates.
async function ensureCustomFieldValues(quote: QuoteWithItems): Promise<QuoteWithItems> {
  if (quote.customFieldValues) return quote;
  const cfvs = await prisma.customFieldValue.findMany({
    where: { quoteId: quote.id },
    orderBy: { id: "asc" },
  });
  return { ...quote, customFieldValues: cfvs };
}

export function defaultEmailSettings(shopDomain: string, locale: "en" | "bg" = "en") {
  const t = DEFAULT_TEMPLATES[locale];
  return {
    shopDomain,
    senderName: shopDomain,
    senderEmail: "",
    emailProvider: "smtp",
    smtpHost: "",
    smtpPort: 587,
    smtpUser: "",
    smtpPassEncrypted: "",
    resendApiKeyEncrypted: "",
    notificationEmails: "",
    sendMerchantNotification: true,
    logoUrl: "",
    customerSubject: t.customerSubject,
    customerBody: t.customerBody,
    merchantSubject: t.merchantSubject,
    merchantBody: t.merchantBody,
  };
}

export async function getOrInitEmailSettings(shopDomain: string): Promise<EmailSettings> {
  const existing = await prisma.emailSettings.findUnique({ where: { shopDomain } });
  if (existing) return existing;
  return prisma.emailSettings.create({ data: defaultEmailSettings(shopDomain) });
}

function buildTransport(settings: EmailSettings): Transporter | null {
  if (!settings.smtpHost || !settings.smtpUser) return null;
  const password = decryptSecret(settings.smtpPassEncrypted);
  if (!password) return null;
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort || 587,
    secure: (settings.smtpPort || 587) === 465,
    auth: { user: settings.smtpUser, pass: password },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
  });
}

type SendEmailArgs = {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
};

async function sendOne(settings: EmailSettings, args: SendEmailArgs): Promise<SendResult> {
  if (settings.emailProvider === "resend") {
    return sendViaResend(settings, args);
  }
  return sendViaSmtp(settings, args);
}

async function sendViaSmtp(settings: EmailSettings, args: SendEmailArgs): Promise<SendResult> {
  const transport = buildTransport(settings);
  if (!transport) return { ok: false, error: "SMTP credentials not configured" };
  try {
    await transport.sendMail({
      from: args.from,
      to: args.to,
      replyTo: args.replyTo,
      subject: args.subject,
      text: args.text,
      html: args.html,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Send via the Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * Used when outbound SMTP is blocked by the host (Railway, Render, etc).
 */
async function sendViaResend(
  settings: EmailSettings,
  args: SendEmailArgs,
): Promise<SendResult> {
  const apiKey = decryptSecret(settings.resendApiKeyEncrypted);
  if (!apiKey) return { ok: false, error: "Resend API key not configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: args.from,
        to: [args.to],
        reply_to: args.replyTo,
        subject: args.subject,
        text: args.text,
        html: args.html,
      }),
      // Hard-bound the API call so a Resend hiccup can't tie up a Railway worker.
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      let message = `Resend returned HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string; name?: string };
        if (body && (body.message || body.name)) {
          message = body.message || body.name || message;
        }
      } catch {
        /* ignore */
      }
      return { ok: false, error: message };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Consumer domains can't be used as the technical "From" with Resend because
// you can't verify ownership of @gmail.com / @yahoo.com / etc. — Resend rejects
// the send. Detect those and route the technical from through onboarding@resend.dev,
// while preserving the merchant's display name. The merchant's address still
// surfaces via Reply-To so replies land in their inbox.
const CONSUMER_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "abv.bg",
  "mail.bg",
  "protonmail.com",
  "proton.me",
]);

function isConsumerEmail(email: string): boolean {
  const domain = (email.split("@")[1] || "").toLowerCase().trim();
  return !!domain && CONSUMER_EMAIL_DOMAINS.has(domain);
}

function buildFromAddress(settings: EmailSettings): string {
  const displayName = (settings.senderName || "QuoteCart").replace(/"/g, "");

  if (settings.emailProvider === "resend") {
    // If the merchant typed a consumer-domain email (gmail etc.), Resend can't
    // send from it — fall back to their test sender. The merchant's email is
    // still used as Reply-To on customer messages (see sendQuoteEmails).
    if (!settings.senderEmail || isConsumerEmail(settings.senderEmail)) {
      return `"${displayName}" <onboarding@resend.dev>`;
    }
    return `"${displayName}" <${settings.senderEmail}>`;
  }

  // SMTP path: can send from any address the SMTP server accepts.
  if (settings.senderEmail) {
    return `"${displayName}" <${settings.senderEmail}>`;
  }
  return settings.smtpUser;
}

export async function sendQuoteEmails(
  quote: QuoteWithItems,
  shopDomain: string,
): Promise<{ customer: SendResult; merchant: SendResult }> {
  const settings = await getOrInitEmailSettings(shopDomain);
  const fromAddress = buildFromAddress(settings);

  const fullQuote = await ensureCustomFieldValues(quote);

  const vars = buildTemplateVars(fullQuote, shopDomain);
  const htmlVars = buildTemplateVars(fullQuote, shopDomain, "html");

  const customerSubject = applyTemplate(
    settings.customerSubject || DEFAULT_TEMPLATES.en.customerSubject,
    vars,
  );
  const customerBodyText = applyTemplate(
    settings.customerBody || DEFAULT_TEMPLATES.en.customerBody,
    vars,
  );
  const customerBodyHtmlInner = markdownToHtml(
    applyTemplate(settings.customerBody || DEFAULT_TEMPLATES.en.customerBody, htmlVars),
  );
  const customerHtml = wrapEmailHtml(customerBodyHtmlInner, { logoUrl: settings.logoUrl });

  // Set Reply-To on the customer confirmation to the merchant's own email
  // (typically a Gmail address). When the customer hits Reply, it lands in
  // the merchant's inbox even though the technical From might be the Resend
  // test sender.
  const customerReplyTo = settings.senderEmail || undefined;

  const customerResult = await sendOne(settings, {
    from: fromAddress,
    to: fullQuote.customerEmail,
    replyTo: customerReplyTo,
    subject: customerSubject,
    text: customerBodyText,
    html: customerHtml,
  });

  // Merchant notification — only if the merchant opted in AND has recipients configured.
  let merchantResult: SendResult;
  if (!settings.sendMerchantNotification) {
    merchantResult = { ok: true };
  } else {
    const recipients = settings.notificationEmails
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (recipients.length === 0) {
      merchantResult = { ok: false, error: "No notification recipients configured" };
    } else {
      const merchantSubject = applyTemplate(
        settings.merchantSubject || DEFAULT_TEMPLATES.en.merchantSubject,
        vars,
      );
      const merchantBodyText = applyTemplate(
        settings.merchantBody || DEFAULT_TEMPLATES.en.merchantBody,
        vars,
      );
      const merchantBodyHtmlInner = markdownToHtml(
        applyTemplate(settings.merchantBody || DEFAULT_TEMPLATES.en.merchantBody, htmlVars),
      );
      const merchantHtml = wrapEmailHtml(merchantBodyHtmlInner, { logoUrl: settings.logoUrl });

      // Resend's API only sends to one recipient at a time (well, supports an array,
      // but we want individual delivery so each merchant address shows as primary).
      // Loop and pick the first failure as the result.
      const results: SendResult[] = [];
      for (const recipient of recipients) {
        const r = await sendOne(settings, {
          from: fromAddress,
          to: recipient,
          replyTo: fullQuote.customerEmail,
          subject: merchantSubject,
          text: merchantBodyText,
          html: merchantHtml,
        });
        results.push(r);
      }
      const firstFailure = results.find((r) => !r.ok);
      merchantResult = firstFailure ?? { ok: true };
    }
  }

  return { customer: customerResult, merchant: merchantResult };
}

export async function sendTestEmail(
  shopDomain: string,
  to: string,
): Promise<SendResult> {
  const settings = await getOrInitEmailSettings(shopDomain);
  const fromAddress = buildFromAddress(settings);
  const html = wrapEmailHtml(
    markdownToHtml("**QuoteCart test email** — if you can read this, your email settings are working."),
    { logoUrl: settings.logoUrl },
  );
  return sendOne(settings, {
    from: fromAddress,
    to,
    subject: `QuoteCart — test email from ${shopDomain}`,
    text: "If you can read this, your email settings are working.",
    html,
  });
}

export type SendResult = { ok: true } | { ok: false; error: string };
