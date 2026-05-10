import nodemailer, { type Transporter } from "nodemailer";
import type { EmailSettings } from "@prisma/client";
import prisma from "../db.server";
import { decryptSecret } from "./crypto.server";
import {
  DEFAULT_TEMPLATES,
  applyTemplate,
  buildTemplateVars,
  type QuoteWithItems,
} from "./email-templates";

// Re-fetch the quote with customFieldValues included before sending — the
// caller may have passed a partial Quote.
async function ensureCustomFieldValues(quote: QuoteWithItems): Promise<QuoteWithItems> {
  if (quote.customFieldValues) return quote;
  const cfvs = await prisma.customFieldValue.findMany({
    where: { quoteId: quote.id },
    orderBy: { id: "asc" },
  });
  return { ...quote, customFieldValues: cfvs };
}

// Re-export the client-safe pieces so existing imports keep working.
export {
  DEFAULT_TEMPLATES,
  TEMPLATE_VARIABLES,
  applyTemplate,
  buildItemsTable,
  buildPreview,
  buildTemplateVars,
  SAMPLE_QUOTE,
} from "./email-templates";
export type { QuoteWithItems, TemplateVariable } from "./email-templates";

export function defaultEmailSettings(shopDomain: string, locale: "en" | "bg" = "en") {
  const t = DEFAULT_TEMPLATES[locale];
  return {
    shopDomain,
    senderName: shopDomain,
    senderEmail: "",
    smtpHost: "",
    smtpPort: 587,
    smtpUser: "",
    smtpPassEncrypted: "",
    notificationEmails: "",
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
    // Defaults are way too generous (minutes). Cap each phase so a
    // misconfigured SMTP server can't keep a Railway worker tied up.
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
  });
}

export async function sendQuoteEmails(
  quote: QuoteWithItems,
  shopDomain: string,
): Promise<{ customer: SendResult; merchant: SendResult }> {
  const settings = await getOrInitEmailSettings(shopDomain);
  const transport = buildTransport(settings);
  if (!transport) {
    const reason = "SMTP credentials not configured";
    return {
      customer: { ok: false, error: reason },
      merchant: { ok: false, error: reason },
    };
  }
  const fromAddress = settings.senderEmail
    ? settings.senderName
      ? `"${settings.senderName.replace(/"/g, "")}" <${settings.senderEmail}>`
      : settings.senderEmail
    : "";

  // Make sure custom field answers are loaded so {{custom_fields}} renders.
  const fullQuote = await ensureCustomFieldValues(quote);

  const vars = buildTemplateVars(fullQuote, shopDomain);
  const htmlVars = buildTemplateVars(fullQuote, shopDomain, "html");

  const customerSubject = applyTemplate(settings.customerSubject || DEFAULT_TEMPLATES.en.customerSubject, vars);
  const customerBody = applyTemplate(settings.customerBody || DEFAULT_TEMPLATES.en.customerBody, vars);
  const customerHtml = wrapHtml(applyTemplate(settings.customerBody || DEFAULT_TEMPLATES.en.customerBody, htmlVars));

  const merchantSubject = applyTemplate(settings.merchantSubject || DEFAULT_TEMPLATES.en.merchantSubject, vars);
  const merchantBody = applyTemplate(settings.merchantBody || DEFAULT_TEMPLATES.en.merchantBody, vars);
  const merchantHtml = wrapHtml(applyTemplate(settings.merchantBody || DEFAULT_TEMPLATES.en.merchantBody, htmlVars));

  const recipients = settings.notificationEmails
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const [customerRes, merchantRes] = await Promise.allSettled([
    transport.sendMail({
      from: fromAddress || settings.smtpUser,
      to: quote.customerEmail,
      subject: customerSubject,
      text: customerBody,
      html: customerHtml,
    }),
    recipients.length > 0
      ? transport.sendMail({
          from: fromAddress || settings.smtpUser,
          to: recipients.join(","),
          replyTo: quote.customerEmail,
          subject: merchantSubject,
          text: merchantBody,
          html: merchantHtml,
        })
      : Promise.reject(new Error("No notification recipients configured")),
  ]);

  return {
    customer: settledToResult(customerRes),
    merchant: settledToResult(merchantRes),
  };
}

function settledToResult(s: PromiseSettledResult<unknown>): SendResult {
  if (s.status === "fulfilled") return { ok: true };
  return { ok: false, error: s.reason instanceof Error ? s.reason.message : String(s.reason) };
}

export async function sendTestEmail(
  shopDomain: string,
  to: string,
): Promise<SendResult> {
  const settings = await getOrInitEmailSettings(shopDomain);
  const transport = buildTransport(settings);
  if (!transport) return { ok: false, error: "SMTP credentials not configured" };
  try {
    await transport.sendMail({
      from: settings.senderEmail
        ? `"${settings.senderName || shopDomain}" <${settings.senderEmail}>`
        : settings.smtpUser,
      to,
      subject: `Quote Cart — test email from ${shopDomain}`,
      text: "If you can read this, your SMTP settings are working.",
      html: "<p>If you can read this, your SMTP settings are working.</p>",
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function wrapHtml(body: string): string {
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(body);
  const inner = looksHtml ? body : body.replace(/\n/g, "<br>");
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.5;padding:24px">${inner}</body></html>`;
}

export type SendResult = { ok: true } | { ok: false; error: string };
