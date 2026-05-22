import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getOrInitTrackingSettings } from "../lib/tracking.server";
import {
  listCustomFields,
  localizeField,
  type FieldDescriptor,
} from "../lib/customField.server";

/**
 * App Proxy entry point: GET /apps/quote
 *
 * Returns a Liquid template that Shopify wraps in the theme's layout, so the
 * quote page inherits the storefront header + footer + theme CSS automatically.
 *
 * The list of quote items lives entirely in `localStorage` on the client, so
 * the server can't render them — we ship the page shell + contact form and
 * let the inline script hydrate from `localStorage`.
 */
// TEMPORARY DEBUG — log everything about the incoming request and compute the
// signature manually so we can pinpoint why the SDK's verify is failing. Remove
// once the App Proxy works again.
function debugSignature(request: Request) {
  try {
    const url = new URL(request.url);
    const receivedSig = url.searchParams.get("signature") || "";
    const params: [string, string][] = [];
    url.searchParams.forEach((v, k) => {
      if (k !== "signature") params.push([k, v]);
    });
    params.sort((a, b) => a[0].localeCompare(b[0]));
    const signedPayload = params.map(([k, v]) => `${k}=${v}`).join("");
    const secret = process.env.SHOPIFY_API_SECRET || "";

    // Use Node's crypto without an import at module scope (keep this file's
    // existing exports clean). Dynamic require is fine in a debug path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require("node:crypto");
    const computed = crypto
      .createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");

    // eslint-disable-next-line no-console
    console.log(
      "[QC proxy debug]",
      "url:", url.pathname + url.search.slice(0, 200),
      "| received_sig:", receivedSig,
      "| computed_sig:", computed,
      "| match:", computed === receivedSig,
      "| secret_len:", secret.length,
      "| signed_payload:", signedPayload.slice(0, 300),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log("[QC proxy debug] failed:", err);
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  debugSignature(request);
  const { liquid, session } = await authenticate.public.appProxy(request);

  const shopDomain = session?.shop || new URL(request.url).searchParams.get("shop") || "";
  const tracking = shopDomain
    ? await getOrInitTrackingSettings(shopDomain)
    : null;
  const rawFields = shopDomain ? await listCustomFields(shopDomain) : [];

  const url = new URL(request.url);
  const currency = (url.searchParams.get("c") || "USD").toUpperCase();
  const lang = (url.searchParams.get("lang") || "en").toLowerCase();
  const t = lang === "bg" ? STRINGS.bg : STRINGS.en;

  // Apply per-language overrides on each custom field before rendering.
  // Falls back to the default label/placeholder/options when no translation exists.
  const customFields: FieldDescriptor[] = rawFields.map((f) => {
    const localized = localizeField(f, lang);
    return {
      ...f,
      label: localized.label,
      placeholder: localized.placeholder,
      options: localized.options,
    };
  });

  const template = renderTemplate({
    t,
    lang,
    currency,
    pixelId: tracking?.metaPixelId || "",
    gtmId: tracking?.gtmContainerId || "",
    ga4Id: tracking?.ga4MeasurementId || "",
    googleAdsId: tracking?.googleAdsConversionId || "",
    googleAdsLabel: tracking?.googleAdsConversionLabel || "",
    clientTrackingEnabled: tracking?.clientTrackingEnabled ?? true,
    customFields,
  });

  return liquid(template);
};

const STRINGS = {
  en: {
    title: "Your Quote",
    empty: "Your quote is empty.",
    continue: "Continue Shopping",
    item: "Product",
    unit: "Unit",
    qty: "Qty",
    line: "Line total",
    remove: "Remove",
    subtotal: "Subtotal",
    contact: "Contact details",
    nameLabel: "Name",
    emailLabel: "Email",
    phoneLabel: "Phone",
    customerTypeLabel: "Are you an individual or a company?",
    individualOption: "Individual",
    companyOption: "Company",
    vatLabel: "VAT / tax number",
    vatPlaceholder: "e.g., BG123456789",
    notesLabel: "Additional notes or questions",
    submit: "Submit Quote Request",
    sending: "Sending…",
    successTitle: "Thank you!",
    successBody:
      "Your quote has been submitted. You'll receive a confirmation email and we'll respond soon.",
    errorTitle: "Something went wrong",
    nameRequired: "Please enter your name.",
    emailRequired: "Please enter a valid email.",
    phoneRequired: "Please enter your phone number.",
    customerTypeRequired: "Please tell us whether you're an individual or a company.",
    vatRequired: "Please enter your company VAT / tax number.",
    emptyError: "Add at least one product to your quote first.",
  },
  bg: {
    title: "Вашата заявка",
    empty: "Вашата заявка е празна.",
    continue: "Продължи пазаруването",
    item: "Продукт",
    unit: "Цена",
    qty: "Бр.",
    line: "Общо",
    remove: "Премахни",
    subtotal: "Междинна сума",
    contact: "Контактни данни",
    nameLabel: "Име",
    emailLabel: "Имейл",
    phoneLabel: "Телефон",
    customerTypeLabel: "Физическо лице или фирма?",
    individualOption: "Физическо лице",
    companyOption: "Фирма",
    vatLabel: "ЕИК / ДДС номер",
    vatPlaceholder: "напр., BG123456789",
    notesLabel: "Допълнителни бележки или въпроси",
    submit: "Изпрати заявка за оферта",
    sending: "Изпращане…",
    successTitle: "Благодарим Ви!",
    successBody:
      "Вашата заявка е изпратена. Ще получите имейл за потвърждение и ще се свържем с Вас скоро.",
    errorTitle: "Нещо се обърка",
    nameRequired: "Моля, въведете име.",
    emailRequired: "Моля, въведете валиден имейл.",
    phoneRequired: "Моля, въведете телефонен номер.",
    customerTypeRequired: "Моля, посочете дали сте физическо лице или фирма.",
    vatRequired: "Моля, въведете ЕИК / ДДС номер на фирмата.",
    emptyError: "Добавете поне един продукт към заявката.",
  },
};

type RenderArgs = {
  t: typeof STRINGS.en;
  lang: string;
  currency: string;
  pixelId: string;
  gtmId: string;
  ga4Id: string;
  googleAdsId: string;
  googleAdsLabel: string;
  clientTrackingEnabled: boolean;
  customFields: FieldDescriptor[];
};

function renderTemplate(args: RenderArgs): string {
  const t = args.t;
  // Returned as a Liquid template fragment; Shopify wraps it in theme.liquid
  // so it inherits the storefront header + footer.
  // We don't use Liquid variables here, but we DO wrap the inline JS in {% raw %}
  // so any future `{{` patterns in user-supplied JSON don't get parsed.
  return `<style>
  .qc-page-wrap { max-width: 960px; margin: 0 auto; padding: 32px 20px 64px; font-family: inherit; color: #1a1a1a; }
  .qc-page-wrap *,.qc-page-wrap *::before,.qc-page-wrap *::after{box-sizing:border-box}
  .qc-page-wrap .qc-h1 { font-size: 30px; line-height: 1.2; font-weight: 700; margin: 0 0 24px; letter-spacing: -0.01em; color: inherit; }
  .qc-card-pg { background:#fff; border:1px solid #e6e6e6; border-radius:12px; padding:24px; margin-bottom:20px; box-shadow:0 1px 2px rgba(0,0,0,0.04); }
  .qc-empty-pg { text-align:center; padding:40px 16px; color:#666; }
  .qc-empty-pg p { margin:0 0 16px; }
  .qc-link-pg { color:#111; font-weight:600; text-decoration:underline; }
  .qc-tbl { width:100%; border-collapse:collapse; }
  .qc-tbl th { text-align:left; font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:0.04em; color:#666; padding:12px 8px; border-bottom:1px solid #ececec; }
  .qc-tbl td { padding:14px 8px; border-bottom:1px solid #f3f3f3; vertical-align:middle; font-size:14px; color:#1a1a1a; }
  .qc-tbl .qc-num { text-align:right; }
  .qc-tbl .qc-center { text-align:center; }
  .qc-thumb-pg { width:56px; height:56px; border-radius:8px; background:#f3f3f3; object-fit:cover; display:block; }
  .qc-prod-pg { display:flex; align-items:center; gap:14px; min-width:0; }
  .qc-prod-info { min-width:0; }
  .qc-prod-title { font-weight:600; color:#111; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .qc-prod-variant { font-size:13px; color:#777; }
  .qc-stepper-pg { display:inline-flex; align-items:center; border:1px solid #d0d0d0; border-radius:8px; overflow:hidden; height:34px; }
  .qc-stepper-pg button { border:0; background:#fafafa; width:32px; height:32px; cursor:pointer; font-size:18px; line-height:1; }
  .qc-stepper-pg button:hover { background:#f0f0f0; }
  .qc-stepper-pg input { width:44px; height:32px; border:0; text-align:center; font-size:14px; font-weight:600; -moz-appearance:textfield; }
  .qc-stepper-pg input::-webkit-outer-spin-button,.qc-stepper-pg input::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
  .qc-rm-pg { background:none; border:0; color:#999; cursor:pointer; padding:6px 8px; border-radius:6px; font-size:13px; }
  .qc-rm-pg:hover { color:#d72c0d; background:#fff5f3; }
  .qc-totals-pg { display:flex; justify-content:flex-end; padding-top:16px; font-size:16px; }
  .qc-totals-pg .qc-row-pg { min-width:240px; display:flex; justify-content:space-between; font-weight:600; }
  .qc-form-grid-pg { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  @media (max-width:640px){ .qc-form-grid-pg{grid-template-columns:1fr;} }
  .qc-field-pg label { display:block; font-size:13px; font-weight:600; color:#333; margin-bottom:6px; }
  .qc-field-pg input,.qc-field-pg textarea { width:100%; padding:10px 12px; border:1px solid #d6d6d6; border-radius:8px; font-size:14px; font-family:inherit; transition:border-color .15s, box-shadow .15s; background:#fff; color:#1a1a1a; }
  .qc-field-pg input:focus,.qc-field-pg textarea:focus { outline:none; border-color:#1a1a1a; box-shadow:0 0 0 3px rgba(0,0,0,.08); }
  .qc-field-pg textarea { min-height:96px; resize:vertical; }
  .qc-field-pg.qc-invalid input,.qc-field-pg.qc-invalid textarea { border-color:#d72c0d; box-shadow:0 0 0 3px rgba(215,44,13,.12); }
  .qc-field-pg input[type=radio] { width:auto; padding:0; margin:0; }
  .qc-radio-row { display:flex; gap:10px; flex-wrap:wrap; margin-top:6px; }
  .qc-radio-option {
    display:flex;
    align-items:center;
    gap:8px;
    flex:1;
    min-width:140px;
    padding:12px 14px;
    border:1px solid #d6d6d6;
    border-radius:10px;
    cursor:pointer;
    transition:border-color .15s, background .15s, box-shadow .15s;
    background:#fff;
    font-size:14px;
    font-weight:500;
  }
  .qc-radio-option:hover { border-color:#1a1a1a; }
  .qc-radio-option:has(input:checked) {
    border-color:#1a1a1a;
    background:#fafafa;
    box-shadow:0 0 0 3px rgba(0,0,0,.06);
  }
  .qc-field-pg.qc-invalid .qc-radio-option { border-color:#d72c0d; }
  .qc-field-error-pg { color:#d72c0d; font-size:12px; margin-top:6px; display:none; }
  .qc-field-pg.qc-invalid .qc-field-error-pg { display:block; }
  .qc-submit-pg { display:inline-flex; align-items:center; justify-content:center; height:48px; padding:0 24px; background:#111; color:#fff; border:0; border-radius:10px; font-weight:600; font-size:15px; cursor:pointer; transition:transform .1s, background .15s; font-family:inherit; }
  .qc-submit-pg:hover { background:#000; }
  .qc-submit-pg:active { transform:scale(.98); }
  .qc-submit-pg:disabled { background:#999; cursor:not-allowed; }
  .qc-banner-pg { padding:14px 16px; border-radius:10px; margin-bottom:16px; font-size:14px; line-height:1.5; }
  .qc-banner-error-pg { background:#fdecea; color:#a4180c; border:1px solid #f5c6c0; }
  .qc-success-pg { text-align:center; padding:48px 24px; }
  .qc-success-icon-pg { width:64px; height:64px; border-radius:50%; background:#e7f5ec; color:#0e6b30; display:inline-flex; align-items:center; justify-content:center; font-size:32px; margin-bottom:16px; }
  .qc-success-pg h2 { margin:0 0 8px; font-size:24px; }
  .qc-success-pg p { margin:0 0 24px; color:#555; }

  /* ----- Mobile (≤640px) ----- */
  @media (max-width: 640px) {
    .qc-page-wrap { padding: 18px 14px 80px; }
    .qc-h1 { font-size: 22px; line-height: 1.2; margin: 0 0 16px; letter-spacing: -0.02em; }
    .qc-card-pg { padding: 14px; margin-bottom: 12px; border-radius: 12px; }

    /* Items: turn the desktop 5-column table into a stacked card per row */
    .qc-tbl thead { display: none; }
    .qc-tbl, .qc-tbl tbody { display: block; }
    .qc-tbl tr {
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-areas:
        "product  close"
        "unit     unit"
        "controls totals";
      gap: 8px 12px;
      padding: 14px 0;
      border-bottom: 1px solid #f0f0f0;
      align-items: center;
    }
    .qc-tbl tr:last-child { border-bottom: 0; }
    .qc-tbl td { padding: 0; border: 0; display: block; }
    .qc-tbl td:nth-child(1) { grid-area: product; }
    .qc-tbl td:nth-child(2) {
      grid-area: unit;
      text-align: left;
      font-size: 13px;
      color: #666;
      padding-left: 68px; /* aligns with product title (56px thumb + 12px gap) */
    }
    .qc-tbl td:nth-child(3) { grid-area: controls; text-align: left; }
    .qc-tbl td:nth-child(4) {
      grid-area: totals;
      text-align: right;
      font-weight: 700;
      font-size: 16px;
    }
    .qc-tbl td:nth-child(5) { grid-area: close; align-self: start; text-align: right; }

    /* Product cell internals */
    .qc-prod-pg { gap: 12px; align-items: flex-start; }
    .qc-thumb-pg { width: 56px; height: 56px; border-radius: 8px; flex-shrink: 0; }
    .qc-prod-title { font-size: 14px; white-space: normal; line-height: 1.3; }
    .qc-prod-variant { font-size: 12px; margin-top: 2px; display: block; }

    /* Bigger tap targets for the stepper */
    .qc-stepper-pg { height: 38px; }
    .qc-stepper-pg button { width: 38px; height: 36px; font-size: 18px; }
    .qc-stepper-pg input { width: 44px; height: 36px; font-size: 14px; }

    /* Remove button — meet iOS 44x44 minimum tap target */
    .qc-rm-pg {
      padding: 8px 10px;
      font-size: 22px;
      line-height: 1;
      min-width: 44px;
      min-height: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    /* Subtotal sits below the items, full-width */
    .qc-totals-pg { font-size: 16px; padding-top: 12px; }
    .qc-totals-pg .qc-row-pg { min-width: 200px; }

    /* Form fields */
    .qc-form-grid-pg { gap: 14px; }
    .qc-field-pg label { font-size: 14px; }
    .qc-field-pg input, .qc-field-pg textarea {
      padding: 14px;
      font-size: 16px; /* iOS will not zoom in on focus when font-size >= 16px */
      border-radius: 10px;
    }
    .qc-field-pg textarea { min-height: 110px; }

    /* Submit — full width, easy thumb reach */
    .qc-submit-pg { width: 100%; height: 52px; font-size: 16px; border-radius: 12px; }

    /* Success state */
    .qc-success-pg { padding: 36px 16px; }
    .qc-success-pg h2 { font-size: 22px; }
    .qc-success-icon-pg { width: 56px; height: 56px; font-size: 28px; }

    /* Banners */
    .qc-banner-pg { padding: 12px 14px; font-size: 14px; line-height: 1.45; }
  }

  /* Very small screens (iPhone SE / 13 mini in portrait, ~375px) */
  @media (max-width: 374px) {
    .qc-page-wrap { padding: 16px 10px 76px; }
    .qc-h1 { font-size: 20px; }
    .qc-card-pg { padding: 12px; }
    .qc-prod-title { font-size: 13px; }
    .qc-thumb-pg { width: 48px; height: 48px; }
    .qc-tbl td:nth-child(2) { padding-left: 60px; }
  }

  /* Honour iOS notched-device safe-area insets */
  @supports (padding: max(0px)) {
    .qc-page-wrap {
      padding-left: max(14px, env(safe-area-inset-left));
      padding-right: max(14px, env(safe-area-inset-right));
      padding-bottom: max(80px, calc(env(safe-area-inset-bottom) + 24px));
    }
  }

  /* Honour reduced-motion preference */
  @media (prefers-reduced-motion: reduce) {
    .qc-submit-pg { transition: none !important; }
  }

  /* Country-code phone input (intl-tel-input v25) — match our card aesthetic */
  .iti { width: 100%; display: block; }
  .iti__tel-input { width: 100%; }
  .iti__country-container { z-index: 5; }
  .iti__dropdown-content {
    font-family: inherit;
    font-size: 14px;
    max-height: 280px;
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.12);
    border: 1px solid #d0d0d0;
    background: #fff;
  }
  .iti__country-list { max-height: 240px; }
  .iti__country { padding: 8px 10px; }
  .iti__country.iti__highlight { background-color: #f0f0f0; }
  .iti__flag { transform: scale(1.05); transform-origin: left center; }
  .iti__search-input {
    padding: 10px 12px;
    border: 0;
    border-bottom: 1px solid #ececec;
    font-size: 14px;
    font-family: inherit;
    width: 100%;
    outline: none;
  }
  .iti--separate-dial-code .iti__selected-dial-code {
    color: #1a1a1a;
    font-weight: 500;
  }
  .iti--show-flags.iti--allow-dropdown .iti__country-container {
    padding: 0 8px;
  }
  .qc-field-pg .iti input[type=tel] {
    padding-left: 92px !important;
  }
  @media (max-width: 640px) {
    .qc-field-pg .iti input[type=tel] {
      padding-left: 88px !important;
      font-size: 16px !important;
    }
    .iti__dropdown-content {
      max-height: 60vh;
    }
  }
</style>

<link
  rel="stylesheet"
  href="https://cdn.jsdelivr.net/npm/intl-tel-input@25.3.1/build/css/intlTelInput.min.css"
/>

<div class="qc-page-wrap">
  <h1 class="qc-h1">${escape(t.title)}</h1>

  <div id="qc-banner" class="qc-banner-pg qc-banner-error-pg" style="display:none" role="alert"></div>

  <div id="qc-success" class="qc-card-pg qc-success-pg" style="display:none">
    <div class="qc-success-icon-pg" aria-hidden="true">✓</div>
    <h2>${escape(t.successTitle)}</h2>
    <p>${escape(t.successBody)}</p>
    <a class="qc-link-pg" href="/">${escape(t.continue)}</a>
  </div>

  <div id="qc-content">
    <div id="qc-empty" class="qc-card-pg qc-empty-pg" style="display:none">
      <p>${escape(t.empty)}</p>
      <a class="qc-link-pg" href="/">${escape(t.continue)}</a>
    </div>

    <div id="qc-list-card" class="qc-card-pg" style="display:none">
      <table class="qc-tbl" id="qc-table">
        <thead>
          <tr>
            <th>${escape(t.item)}</th>
            <th class="qc-num">${escape(t.unit)}</th>
            <th class="qc-center">${escape(t.qty)}</th>
            <th class="qc-num">${escape(t.line)}</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="qc-tbody"></tbody>
      </table>
      <div class="qc-totals-pg">
        <div class="qc-row-pg">
          <span>${escape(t.subtotal)}</span>
          <span id="qc-subtotal">${escape(args.currency)} 0.00</span>
        </div>
      </div>
    </div>

    <form id="qc-form" class="qc-card-pg" novalidate aria-labelledby="qc-form-h">
      <h2 id="qc-form-h" style="margin:0 0 16px;font-size:18px">${escape(t.contact)}</h2>
      <div class="qc-form-grid-pg">
        <div class="qc-field-pg" id="qc-field-name">
          <label for="qc-name">${escape(t.nameLabel)} *</label>
          <input id="qc-name" name="customerName" type="text" required autocomplete="name" />
          <div class="qc-field-error-pg">${escape(t.nameRequired)}</div>
        </div>
        <div class="qc-field-pg" id="qc-field-email">
          <label for="qc-email">${escape(t.emailLabel)} *</label>
          <input id="qc-email" name="customerEmail" type="email" required autocomplete="email" />
          <div class="qc-field-error-pg">${escape(t.emailRequired)}</div>
        </div>
        <div class="qc-field-pg" id="qc-field-phone">
          <label for="qc-phone">${escape(t.phoneLabel)} *</label>
          <input id="qc-phone" name="customerPhone" type="tel" required autocomplete="tel" />
          <div class="qc-field-error-pg">${escape(t.phoneRequired)}</div>
        </div>

        <div class="qc-field-pg" id="qc-field-customerType" style="grid-column:1/-1">
          <label>${escape(t.customerTypeLabel)} *</label>
          <div class="qc-radio-row">
            <label class="qc-radio-option">
              <input type="radio" name="customerType" value="individual" id="qc-ct-individual" />
              <span>${escape(t.individualOption)}</span>
            </label>
            <label class="qc-radio-option">
              <input type="radio" name="customerType" value="company" id="qc-ct-company" />
              <span>${escape(t.companyOption)}</span>
            </label>
          </div>
          <div class="qc-field-error-pg">${escape(t.customerTypeRequired)}</div>
        </div>

        <div class="qc-field-pg" id="qc-field-vat" style="grid-column:1/-1;display:none">
          <label for="qc-vat">${escape(t.vatLabel)} *</label>
          <input id="qc-vat" name="vatNumber" type="text" placeholder="${escape(t.vatPlaceholder)}" autocomplete="off" />
          <div class="qc-field-error-pg">${escape(t.vatRequired)}</div>
        </div>

        <div class="qc-field-pg" style="grid-column:1/-1">
          <label for="qc-message">${escape(t.notesLabel)}</label>
          <textarea id="qc-message" name="message"></textarea>
        </div>
        ${args.customFields.map(renderCustomField).join("\n")}
      </div>
      <div style="margin-top:20px">
        <button id="qc-submit" type="submit" class="qc-submit-pg">${escape(t.submit)}</button>
      </div>
    </form>
  </div>
</div>

{% raw %}<script>
window.QUOTE_CART_PAGE = ${JSON.stringify({
    currency: args.currency,
    lang: args.lang,
    strings: t,
    tracking: args.clientTrackingEnabled
      ? {
          pixelId: args.pixelId,
          ga4Id: args.ga4Id,
          googleAdsId: args.googleAdsId,
          googleAdsLabel: args.googleAdsLabel,
          gtmId: args.gtmId,
        }
      : null,
  })};
</script>{% endraw %}
${args.gtmId && args.clientTrackingEnabled ? renderGtm(args.gtmId) : ""}
${args.pixelId && args.clientTrackingEnabled ? renderFbq(args.pixelId) : ""}
${args.ga4Id && args.clientTrackingEnabled ? renderGtag(args.ga4Id, args.googleAdsId) : ""}
${renderInlinePageScript()}`;
}

function renderGtm(id: string): string {
  return `{% raw %}<script>
  window.dataLayer = window.dataLayer || [];
  (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
  var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;
  f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');
</script>{% endraw %}`;
}

function renderFbq(id: string): string {
  return `{% raw %}<script>
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '${id}'); fbq('track', 'PageView');
</script>{% endraw %}`;
}

function renderGtag(ga4Id: string, googleAdsId: string): string {
  const tags = [ga4Id, googleAdsId].filter(Boolean);
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga4Id}"></script>
{% raw %}<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);} window.gtag = gtag;
  gtag('js', new Date());
  ${tags.map((t) => `gtag('config', '${t}');`).join("\n  ")}
</script>{% endraw %}`;
}

function renderInlinePageScript(): string {
  // Wrapped in {% raw %} so Liquid doesn't try to parse `{{` patterns inside
  // user data once the script runs. The script body itself is plain JS.
  return `<script src="https://cdn.jsdelivr.net/npm/intl-tel-input@25.3.1/build/js/intlTelInput.min.js" defer></script>
{% raw %}<script>
(function(){
  var QC = window.QUOTE_CART_PAGE || {};
  var STORAGE_KEY = "quote_cart";
  var GCLID_KEY = "quote_cart_gclid";

  // Initialize country-code phone picker once intl-tel-input has loaded.
  // v25+ renders flags as inline SVG (no sprite image dependency) and enables
  // countrySearch by default so the merchant's customers can type to filter.
  // Falls back to a plain tel input if the CDN is blocked.
  var phoneIti = null;
  function initPhone(){
    var input = document.getElementById("qc-phone");
    if(!input || !window.intlTelInput) return;
    try {
      phoneIti = window.intlTelInput(input, {
        initialCountry: "auto",
        geoIpLookup: function(success){
          fetch("https://ipapi.co/json/")
            .then(function(r){ return r.json(); })
            .then(function(data){ success(data && data.country_code ? data.country_code : "us"); })
            .catch(function(){ success("us"); });
        },
        loadUtilsOnInit: "https://cdn.jsdelivr.net/npm/intl-tel-input@25.3.1/build/js/utils.js",
        separateDialCode: true,
        autoPlaceholder: "polite",
        countrySearch: true,
        formatAsYouType: true,
        showFlags: true,
        useFullscreenPopup: false,
      });
    } catch (e) { phoneIti = null; }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function(){
      // intl-tel-input script may load after DOMContentLoaded due to defer; retry briefly.
      var tries = 0;
      var iv = setInterval(function(){
        if (window.intlTelInput) { clearInterval(iv); initPhone(); }
        else if (++tries > 40) clearInterval(iv);
      }, 50);
    });
  } else {
    var tries = 0;
    var iv = setInterval(function(){
      if (window.intlTelInput) { clearInterval(iv); initPhone(); }
      else if (++tries > 40) clearInterval(iv);
    }, 50);
  }

  // Toggle VAT field visibility based on the selected customer type.
  document.addEventListener("change", function(e){
    if(e.target && e.target.name === "customerType"){
      var vat = document.getElementById("qc-field-vat");
      if(!vat) return;
      vat.style.display = e.target.value === "company" ? "block" : "none";
    }
  });

  function safeRead(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }catch(e){
      try{ localStorage.removeItem(STORAGE_KEY); }catch(_){ }
      return [];
    }
  }
  function safeWrite(items){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }catch(e){}
  }
  function fmtMoney(n){
    return (QC.currency || "USD") + " " + (Number(n)||0).toFixed(2);
  }
  function readGclid(){
    try{
      var raw = localStorage.getItem(GCLID_KEY);
      if(!raw) return null;
      var data = JSON.parse(raw);
      if(!data || !data.value) return null;
      if(data.timestamp && (Date.now() - data.timestamp) > 90*24*60*60*1000) return null;
      return data.value;
    }catch(e){ return null; }
  }
  function getCookie(name){
    var match = document.cookie.match(new RegExp("(^| )" + name.replace(/[-/\\\\^$*+?.()|[\\]{}]/g,'\\\\$&') + "=([^;]+)"));
    return match ? decodeURIComponent(match[2]) : "";
  }

  function render(){
    var items = safeRead();
    var emptyEl = document.getElementById("qc-empty");
    var listEl = document.getElementById("qc-list-card");
    var formEl = document.getElementById("qc-form");
    var tbody = document.getElementById("qc-tbody");
    var subtotalEl = document.getElementById("qc-subtotal");

    if(!items.length){
      if(emptyEl) emptyEl.style.display = "block";
      if(listEl) listEl.style.display = "none";
      if(formEl) formEl.style.display = "none";
      if(subtotalEl) subtotalEl.textContent = fmtMoney(0);
      return;
    }
    if(emptyEl) emptyEl.style.display = "none";
    if(listEl) listEl.style.display = "block";
    if(formEl) formEl.style.display = "block";

    var html = "";
    var subtotal = 0;
    for(var i=0;i<items.length;i++){
      var it = items[i];
      var price = parseFloat(it.price)||0;
      var qty = parseInt(it.quantity,10)||1;
      var line = price * qty;
      subtotal += line;
      html += '<tr data-variant="'+esc(it.variantId)+'">' +
        '<td><div class="qc-prod-pg">' +
          '<img class="qc-thumb-pg" src="'+esc(it.image||"")+'" alt="" onerror="this.style.visibility=\\'hidden\\'" />' +
          '<div class="qc-prod-info"><span class="qc-prod-title">'+esc(it.productTitle)+'</span>' +
          (it.variantTitle ? '<span class="qc-prod-variant">'+esc(it.variantTitle)+'</span>' : '') +
          '</div></div></td>' +
        '<td class="qc-num">'+fmtMoney(price)+'</td>' +
        '<td class="qc-center"><div class="qc-stepper-pg" role="group" aria-label="Quantity">' +
          '<button type="button" data-action="dec" aria-label="Decrease">−</button>' +
          '<input type="number" min="1" value="'+qty+'" data-action="qty" aria-label="Quantity"/>' +
          '<button type="button" data-action="inc" aria-label="Increase">+</button>' +
          '</div></td>' +
        '<td class="qc-num">'+fmtMoney(line)+'</td>' +
        '<td class="qc-num"><button type="button" class="qc-rm-pg" data-action="remove" aria-label="Remove">×</button></td>' +
      '</tr>';
    }
    tbody.innerHTML = html;
    if(subtotalEl) subtotalEl.textContent = fmtMoney(subtotal);
  }

  function esc(s){ s = String(s == null ? "" : s); return s.replace(/[&<>"]/g, function(c){ return ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"})[c]; }); }

  function update(variantId, qty){
    var items = safeRead();
    var found = false;
    for(var i=0;i<items.length;i++){
      if(String(items[i].variantId) === String(variantId)){
        items[i].quantity = Math.max(1, parseInt(qty,10)||1);
        found = true;
      }
    }
    if(!found) return;
    safeWrite(items);
    window.dispatchEvent(new CustomEvent("quote:updated", { detail: { items: items } }));
    render();
  }

  function remove(variantId){
    var items = safeRead().filter(function(it){ return String(it.variantId) !== String(variantId); });
    safeWrite(items);
    window.dispatchEvent(new CustomEvent("quote:updated", { detail: { items: items } }));
    render();
  }

  document.addEventListener("click", function(e){
    var btn = e.target.closest && e.target.closest("[data-action]");
    if(!btn) return;
    var row = btn.closest("tr"); if(!row) return;
    var variantId = row.getAttribute("data-variant");
    var action = btn.getAttribute("data-action");
    var input = row.querySelector("input[data-action='qty']");
    var current = input ? (parseInt(input.value,10)||1) : 1;
    if(action === "inc"){ update(variantId, current+1); }
    if(action === "dec"){ update(variantId, Math.max(1,current-1)); }
    if(action === "remove"){ remove(variantId); }
  });
  document.addEventListener("change", function(e){
    var t = e.target;
    if(t.matches && t.matches("input[data-action='qty']")){
      var row = t.closest("tr"); if(!row) return;
      update(row.getAttribute("data-variant"), t.value);
    }
  });

  function validate(){
    var ok = true;
    var name = document.getElementById("qc-name");
    var email = document.getElementById("qc-email");
    var phone = document.getElementById("qc-phone");

    function set(field, valid){
      var el = document.getElementById("qc-field-"+field);
      if(!el) return;
      if(valid) el.classList.remove("qc-invalid"); else el.classList.add("qc-invalid");
      if(!valid) ok = false;
    }
    set("name", name.value.trim().length >= 2);
    set("email", /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email.value.trim()));
    // Phone validation — lenient. isValidNumber is overly strict and can flag
    // real Bulgarian / international numbers as invalid. Layered fallback:
    //   1. isValidNumber (strictest — perfect match for country format)
    //   2. isPossibleNumber (length-based — accepts most realistic numbers)
    //   3. Raw digit count (6+ digits is good enough for a quote form)
    var phoneRaw = phone.value.trim();
    var digitCount = (phoneRaw.match(/\\d/g) || []).length;
    var phoneOk = false;
    if (digitCount >= 6) {
      if (phoneIti) {
        if (typeof phoneIti.isValidNumber === "function" && phoneIti.isValidNumber()) {
          phoneOk = true;
        } else if (typeof phoneIti.isPossibleNumber === "function" && phoneIti.isPossibleNumber()) {
          phoneOk = true;
        } else {
          // Library says no, but we have 6+ digits — accept anyway. The merchant can
          // double-check and reach out manually if the number turns out malformed.
          phoneOk = true;
        }
      } else {
        phoneOk = true;
      }
    }
    set("phone", phoneOk);

    // Customer type: must be picked. VAT: required if "company".
    var ctRadios = document.querySelectorAll('input[name="customerType"]');
    var customerType = "";
    for(var ci=0; ci<ctRadios.length; ci++){
      if(ctRadios[ci].checked){ customerType = ctRadios[ci].value; break; }
    }
    set("customerType", customerType === "individual" || customerType === "company");
    if(customerType === "company"){
      var vatEl = document.getElementById("qc-vat");
      set("vat", vatEl && vatEl.value.trim().length >= 3);
    } else {
      var vatWrap = document.getElementById("qc-field-vat");
      if(vatWrap) vatWrap.classList.remove("qc-invalid");
    }

    // Validate custom fields
    var cfInputs = document.querySelectorAll("[data-qc-cf]");
    for (var i = 0; i < cfInputs.length; i++) {
      var el = cfInputs[i];
      var id = el.getAttribute("data-qc-cf");
      var required = el.getAttribute("data-qc-cf-required") === "1";
      var type = el.getAttribute("data-qc-cf-type");
      var v = (el.value || "").trim();
      var wrap = document.getElementById("qc-field-cf-" + id);
      var valid = true;
      if (required && !v) valid = false;
      else if (v && type === "email" && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v)) valid = false;
      if (wrap) {
        if (valid) wrap.classList.remove("qc-invalid");
        else { wrap.classList.add("qc-invalid"); ok = false; }
      }
    }
    return ok;
  }

  function showBanner(msg){
    var b = document.getElementById("qc-banner");
    if(!b) return;
    b.textContent = msg;
    b.style.display = "block";
    b.scrollIntoView({behavior:"smooth", block:"center"});
  }
  function hideBanner(){
    var b = document.getElementById("qc-banner");
    if(b) b.style.display = "none";
  }

  function fireClientEvents(payload){
    if(!QC.tracking) return;
    var dl = window.dataLayer = window.dataLayer || [];
    dl.push({
      event: "quote_submitted",
      quote_id: payload.quote_id,
      quote_value: payload.value,
      item_count: payload.item_count,
      currency: payload.currency,
      items: payload.items,
      eventID: payload.event_id,
    });
    if(typeof window.fbq === "function" && QC.tracking.pixelId){
      window.fbq("track", "Lead", {
        value: payload.value,
        currency: payload.currency,
        content_ids: payload.items.map(function(i){return i.id;}),
        content_type: "product",
        eventID: payload.event_id,
      }, { eventID: payload.event_id });
      window.fbq("trackCustom", "QuoteSubmitted", {
        value: payload.value,
        currency: payload.currency,
        item_count: payload.item_count,
        eventID: payload.event_id,
      }, { eventID: payload.event_id });
    }
    if(typeof window.gtag === "function" && QC.tracking.ga4Id){
      window.gtag("event", "generate_lead", {
        value: payload.value,
        currency: payload.currency,
        items: payload.items.map(function(i){return {item_id:i.id,item_name:i.name,price:i.price,quantity:i.quantity};}),
        transaction_id: payload.quote_id,
        event_id: payload.event_id,
      });
      if(QC.tracking.googleAdsId && QC.tracking.googleAdsLabel){
        window.gtag("event", "conversion", {
          send_to: QC.tracking.googleAdsId + "/" + QC.tracking.googleAdsLabel,
          value: payload.value,
          currency: payload.currency,
          transaction_id: payload.quote_id,
        });
      }
    }
    window.dispatchEvent(new CustomEvent("quote:submitted", { detail: payload }));
  }

  function fireInitiateQuote(){
    if(!QC.tracking) return;
    var items = safeRead();
    if(!items.length) return;
    var subtotal = items.reduce(function(s,i){return s + (parseFloat(i.price)||0)*(parseInt(i.quantity,10)||1);},0);
    var dl = window.dataLayer = window.dataLayer || [];
    dl.push({event:"initiate_quote", quote_value:subtotal, currency: QC.currency, items: items});
    if(typeof window.fbq === "function" && QC.tracking.pixelId){
      window.fbq("trackCustom", "InitiateQuote", {
        value: subtotal,
        currency: QC.currency,
        num_items: items.length,
      });
    }
  }

  document.getElementById("qc-form").addEventListener("submit", function(e){
    e.preventDefault();
    hideBanner();
    var items = safeRead();
    if(!items.length){
      showBanner(QC.strings.emptyError);
      return;
    }
    if(!validate()) return;

    var btn = document.getElementById("qc-submit");
    btn.disabled = true;
    btn.textContent = QC.strings.sending;

    // Use the full international number from intl-tel-input when available.
    var phoneFullNumber = (phoneIti && typeof phoneIti.getNumber === "function")
      ? phoneIti.getNumber()
      : document.getElementById("qc-phone").value.trim();

    // Collect custom field values into an object keyed by field id.
    var customFieldsPayload = {};
    var cfList = document.querySelectorAll("[data-qc-cf]");
    for (var k = 0; k < cfList.length; k++) {
      var cf = cfList[k];
      customFieldsPayload[cf.getAttribute("data-qc-cf")] = (cf.value || "").trim();
    }

    // Read customerType / vatNumber from the radio + VAT input.
    var ctRadios2 = document.querySelectorAll('input[name="customerType"]');
    var ctValue = "";
    for(var ci2=0; ci2<ctRadios2.length; ci2++){
      if(ctRadios2[ci2].checked){ ctValue = ctRadios2[ci2].value; break; }
    }
    var vatVal = document.getElementById("qc-vat");

    var body = {
      customerName: document.getElementById("qc-name").value.trim(),
      customerEmail: document.getElementById("qc-email").value.trim(),
      customerPhone: phoneFullNumber,
      message: document.getElementById("qc-message").value.trim(),
      customerType: ctValue,
      vatNumber: ctValue === "company" && vatVal ? vatVal.value.trim() : "",
      items: items,
      currency: QC.currency,
      gclid: readGclid(),
      fbp: getCookie("_fbp"),
      fbc: getCookie("_fbc"),
      ga: getCookie("_ga"),
      pageUrl: window.location.href,
      customFields: customFieldsPayload
    };

    fetch("/apps/quote/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept":"application/json" },
      body: JSON.stringify(body),
    }).then(function(r){
      return r.json().then(function(data){ return { ok: r.ok, data: data }; });
    }).then(function(res){
      btn.disabled = false;
      btn.textContent = QC.strings.submit;
      if(!res.ok || !res.data || res.data.ok !== true){
        var err = (res.data && res.data.error) ? res.data.error : QC.strings.errorTitle;
        showBanner(err);
        return;
      }
      try{ localStorage.removeItem(STORAGE_KEY); }catch(_){ }
      window.dispatchEvent(new CustomEvent("quote:updated", { detail: { items: [] } }));
      fireClientEvents(res.data);
      var content = document.getElementById("qc-content");
      var success = document.getElementById("qc-success");
      if(content) content.style.display = "none";
      if(success) success.style.display = "block";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }).catch(function(err){
      btn.disabled = false;
      btn.textContent = QC.strings.submit;
      showBanner(QC.strings.errorTitle + ": " + (err && err.message ? err.message : ""));
    });
  });

  window.addEventListener("storage", function(e){
    if(e.key === STORAGE_KEY) render();
  });
  window.addEventListener("quote:updated", function(){ render(); });

  render();
  fireInitiateQuote();
})();
</script>{% endraw %}`;
}

function renderCustomField(f: FieldDescriptor): string {
  const id = `qc-cf-${escape(f.id)}`;
  const reqStar = f.required ? " *" : "";
  const reqAttr = f.required ? "required" : "";
  const labelHtml = `<label for="${id}">${escape(f.label)}${reqStar}</label>`;
  const errorHtml = `<div class="qc-field-error-pg">${escape(f.label)} is required.</div>`;
  let inputHtml = "";
  switch (f.fieldType) {
    case "textarea":
      inputHtml = `<textarea id="${id}" name="cf::${escape(f.id)}" data-qc-cf="${escape(
        f.id,
      )}" data-qc-cf-required="${f.required ? "1" : "0"}" data-qc-cf-type="textarea" placeholder="${escape(
        f.placeholder,
      )}" ${reqAttr}></textarea>`;
      break;
    case "email":
      inputHtml = `<input id="${id}" name="cf::${escape(f.id)}" type="email" data-qc-cf="${escape(
        f.id,
      )}" data-qc-cf-required="${f.required ? "1" : "0"}" data-qc-cf-type="email" placeholder="${escape(
        f.placeholder,
      )}" autocomplete="email" ${reqAttr} />`;
      break;
    case "tel":
      inputHtml = `<input id="${id}" name="cf::${escape(f.id)}" type="tel" data-qc-cf="${escape(
        f.id,
      )}" data-qc-cf-required="${f.required ? "1" : "0"}" data-qc-cf-type="tel" placeholder="${escape(
        f.placeholder,
      )}" autocomplete="tel" ${reqAttr} />`;
      break;
    case "select": {
      const opts = f.options
        .map((o) => `<option value="${escape(o)}">${escape(o)}</option>`)
        .join("");
      inputHtml = `<select id="${id}" name="cf::${escape(f.id)}" data-qc-cf="${escape(
        f.id,
      )}" data-qc-cf-required="${f.required ? "1" : "0"}" data-qc-cf-type="select" ${reqAttr}>
  <option value="">${escape(f.placeholder || "Select…")}</option>
  ${opts}
</select>`;
      break;
    }
    case "text":
    default:
      inputHtml = `<input id="${id}" name="cf::${escape(f.id)}" type="text" data-qc-cf="${escape(
        f.id,
      )}" data-qc-cf-required="${f.required ? "1" : "0"}" data-qc-cf-type="text" placeholder="${escape(
        f.placeholder,
      )}" ${reqAttr} />`;
      break;
  }
  return `<div class="qc-field-pg" id="qc-field-cf-${escape(
    f.id,
  )}" style="grid-column:1/-1">
  ${labelHtml}
  ${inputHtml}
  ${errorHtml}
</div>`;
}

function escape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
