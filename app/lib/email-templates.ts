/**
 * Email template constants + pure helpers.
 *
 * Lives outside `*.server.ts` because both the server and the client
 * (Settings page live preview) need access. Nodemailer / Prisma / crypto
 * stay in `email.server.ts`.
 */

import type { Quote, QuoteItem, CustomFieldValue } from "@prisma/client";

export type QuoteWithItems = Quote & {
  items: QuoteItem[];
  customFieldValues?: CustomFieldValue[];
};

export const SAMPLE_QUOTE: QuoteWithItems = {
  id: "sample_QUOTE_ID",
  shopDomain: "example.myshopify.com",
  customerName: "Jane Doe",
  customerEmail: "jane@example.com",
  customerPhone: "+1 555 123 4567",
  message: "Could you please confirm bulk pricing on these items?",
  customerType: "company",
  vatNumber: "BG123456789",
  status: "new",
  internalNotes: "",
  createdAt: new Date(),
  respondedAt: null,
  shopifyDraftOrderId: null,
  shopifyDraftOrderName: null,
  shopifyDraftOrderUrl: null,
  items: [
    {
      id: "sample_item_1",
      quoteId: "sample_QUOTE_ID",
      productId: "1",
      variantId: "1",
      productTitle: "Sample Product A",
      variantTitle: "Default",
      image: "",
      price: "49.00",
      quantity: 2,
    },
    {
      id: "sample_item_2",
      quoteId: "sample_QUOTE_ID",
      productId: "2",
      variantId: "2",
      productTitle: "Sample Product B",
      variantTitle: "Large",
      image: "",
      price: "129.00",
      quantity: 1,
    },
  ],
};

export const TEMPLATE_VARIABLES = [
  "customer_name",
  "customer_email",
  "customer_phone",
  "customer_type",
  "vat_number",
  "customer_message",
  "items_table",
  "custom_fields",
  "shop_name",
  "quote_id",
  "submitted_at",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export const DEFAULT_TEMPLATES = {
  en: {
    customerSubject: "We received your quote request — {{shop_name}}",
    customerBody: `Hi {{customer_name}},

Thank you for your quote request at {{shop_name}}. Our team will review the items below and get back to you shortly with pricing and availability.

Your request:
{{items_table}}

Your message:
{{customer_message}}

Quote ID: {{quote_id}}
Submitted: {{submitted_at}}

If anything looks off, just reply to this email.

Best,
{{shop_name}}`,
    merchantSubject: "New quote request from {{customer_name}}",
    merchantBody: `A new quote was submitted on {{shop_name}}.

Customer
  Name:  {{customer_name}}
  Email: {{customer_email}}
  Phone: {{customer_phone}}

Items
{{items_table}}

Message
{{customer_message}}

Custom fields
{{custom_fields}}

Quote ID: {{quote_id}}
Submitted: {{submitted_at}}`,
  },
  bg: {
    customerSubject: "Получихме вашата заявка за оферта — {{shop_name}}",
    customerBody: `Здравейте, {{customer_name}},

Благодарим Ви за заявката за оферта в {{shop_name}}. Нашият екип ще прегледа продуктите по-долу и ще се свърже с Вас скоро с цени и наличности.

Вашата заявка:
{{items_table}}

Вашето съобщение:
{{customer_message}}

Номер на заявката: {{quote_id}}
Подадена на: {{submitted_at}}

Ако нещо не изглежда правилно, просто отговорете на този имейл.

Поздрави,
{{shop_name}}`,
    merchantSubject: "Нова заявка за оферта от {{customer_name}}",
    merchantBody: `Нова заявка за оферта в {{shop_name}}.

Клиент
  Име:    {{customer_name}}
  Имейл:  {{customer_email}}
  Телефон: {{customer_phone}}

Продукти
{{items_table}}

Съобщение
{{customer_message}}

Допълнителни полета
{{custom_fields}}

Номер на заявката: {{quote_id}}
Подадена на: {{submitted_at}}`,
  },
} as const;

export function buildItemsTable(
  items: QuoteItem[],
  opts: { format?: "text" | "html" } = {},
): string {
  const format = opts.format ?? "text";
  if (format === "html") {
    const rows = items
      .map((it) => {
        const price = parseFloat(it.price) || 0;
        const lineTotal = price * it.quantity;
        const variant = it.variantTitle ? ` (${escapeHtml(it.variantTitle)})` : "";
        return `<tr>
  <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(it.productTitle)}${variant}</td>
  <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${it.quantity}</td>
  <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatPrice(price)}</td>
  <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatPrice(lineTotal)}</td>
</tr>`;
      })
      .join("\n");
    return `<table style="width:100%;border-collapse:collapse;font-family:system-ui,sans-serif">
<thead>
  <tr style="background:#f6f6f6">
    <th style="padding:8px;text-align:left">Product</th>
    <th style="padding:8px;text-align:center">Qty</th>
    <th style="padding:8px;text-align:right">Unit</th>
    <th style="padding:8px;text-align:right">Total</th>
  </tr>
</thead>
<tbody>
${rows}
</tbody>
</table>`;
  }
  const lines = items.map((it) => {
    const variant = it.variantTitle ? ` (${it.variantTitle})` : "";
    const price = parseFloat(it.price) || 0;
    return `  - ${it.productTitle}${variant}  x${it.quantity}  @ ${formatPrice(price)}  = ${formatPrice(price * it.quantity)}`;
  });
  return lines.join("\n");
}

function formatPrice(n: number): string {
  return n.toFixed(2);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Tiny Markdown → HTML converter for email bodies.
 * Supports: # ## ### headings, **bold**, *italic*, [text](url),
 * ![alt](url) images, --- horizontal rule, - bulleted lists,
 * paragraphs (separated by blank lines), and bare URLs auto-linked.
 *
 * Preserves any HTML the merchant typed directly (so they can paste
 * raw <table> or <img> from a designer's HTML email template).
 */
export function markdownToHtml(input: string): string {
  if (!input) return "";

  // If the body has any block-level HTML, use it as-is. Email clients
  // are conservative about HTML inside HTML, so we don't try to "double-render".
  if (/<(div|table|p|h[1-6]|img|a|section|article|blockquote)\b/i.test(input)) {
    return input;
  }

  const lines = input.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    out.push(`<p style="margin:0 0 16px;line-height:1.6">${formatInline(para.join(" "))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      flushPara();
      closeList();
      out.push('<hr style="border:0;border-top:1px solid #e6e6e6;margin:20px 0">');
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushPara();
      closeList();
      const level = heading[1].length;
      const sizes = [22, 18, 16];
      out.push(
        `<h${level} style="margin:24px 0 12px;font-size:${sizes[level - 1]}px;font-weight:700;line-height:1.3">${formatInline(heading[2])}</h${level}>`,
      );
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushPara();
      if (!inList) {
        out.push('<ul style="margin:0 0 16px;padding-left:20px;line-height:1.6">');
        inList = true;
      }
      out.push(`<li>${formatInline(bullet[1])}</li>`);
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara();
  closeList();
  return out.join("\n");
}

function formatInline(s: string): string {
  // Already-rendered content from buildItemsTable / buildCustomFieldsTable
  // contains <table>; pass it through untouched.
  if (/<(table|img|a)\b/i.test(s)) return s;
  let out = s;
  // Images first (before links — they share the syntax)
  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_m, alt, url) =>
      `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;border-radius:4px;display:inline-block">`,
  );
  // Links
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, text, url) =>
      `<a href="${escapeHtml(url)}" style="color:#1f6feb;text-decoration:underline">${escapeHtml(text)}</a>`,
  );
  // Bold and italic — order matters (** before *)
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  // Auto-link bare URLs that aren't already inside an <a>
  out = out.replace(
    /(^|\s)(https?:\/\/[^\s<]+)/g,
    (_m, pre, url) =>
      `${pre}<a href="${escapeHtml(url)}" style="color:#1f6feb;text-decoration:underline">${escapeHtml(url)}</a>`,
  );
  return out;
}

/**
 * Wraps a rendered HTML body inside a basic styled email container.
 * Optional logo gets prepended at the top.
 */
export function wrapEmailHtml(htmlBody: string, opts: { logoUrl?: string } = {}): string {
  const logoBlock = opts.logoUrl
    ? `<div style="text-align:center;margin-bottom:24px"><img src="${escapeHtml(
        opts.logoUrl,
      )}" alt="" style="max-width:160px;max-height:80px;height:auto"></div>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:24px 12px;background:#f6f6f6">
  <tr><td align="center">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;padding:32px 28px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <tr><td style="font-size:15px;line-height:1.6">
        ${logoBlock}
        ${htmlBody}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function applyTemplate(
  template: string,
  vars: Record<TemplateVariable, string>,
): string {
  let out = template;
  for (const k of TEMPLATE_VARIABLES) {
    out = out.split(`{{${k}}}`).join(vars[k]);
  }
  return out;
}

export function buildTemplateVars(
  quote: QuoteWithItems,
  shopDomain: string,
  itemsFormat: "text" | "html" = "text",
): Record<TemplateVariable, string> {
  const customerType = quote.customerType
    ? quote.customerType === "company"
      ? "Company"
      : "Individual"
    : "";
  return {
    customer_name: quote.customerName,
    customer_email: quote.customerEmail,
    customer_phone: quote.customerPhone,
    customer_type: customerType,
    vat_number: quote.vatNumber || "",
    customer_message: quote.message || "(no message)",
    items_table: buildItemsTable(quote.items, { format: itemsFormat }),
    custom_fields: buildCustomFieldsTable(quote.customFieldValues || [], itemsFormat),
    shop_name: shopDomain,
    quote_id: quote.id,
    submitted_at: quote.createdAt.toISOString(),
  };
}

function buildCustomFieldsTable(
  values: CustomFieldValue[],
  format: "text" | "html",
): string {
  if (!values.length) return "";
  if (format === "html") {
    const rows = values
      .map(
        (v) =>
          `<tr>
  <td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;width:30%">${escapeHtml(v.fieldLabel)}</td>
  <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(v.fieldValue || "—")}</td>
</tr>`,
      )
      .join("\n");
    return `<table style="width:100%;border-collapse:collapse;font-family:system-ui,sans-serif;margin-top:8px">${rows}</table>`;
  }
  return values
    .map((v) => `  ${v.fieldLabel}: ${v.fieldValue || "—"}`)
    .join("\n");
}

export function buildPreview(
  template: { subject: string; body: string },
  shopDomain: string,
): { subject: string; body: string } {
  const vars = buildTemplateVars(SAMPLE_QUOTE, shopDomain || "your-shop.myshopify.com");
  return {
    subject: applyTemplate(template.subject, vars),
    body: applyTemplate(template.body, vars),
  };
}
