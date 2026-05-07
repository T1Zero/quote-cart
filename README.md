# Quote Cart

A Shopify app that replaces the standard Add-to-Cart flow with a request-for-quote flow.
Customers add products to a quote, submit a contact form, get an email confirmation,
and the merchant gets notified to respond manually. The quote submission also serves as
the conversion event for ad platforms (Meta, Google Ads, GA4).

Built on the official Shopify Remix template (TypeScript) with a Theme App Extension,
an App Proxy, Prisma + SQLite, Polaris admin, and Nodemailer for transactional email.

---

## Tech stack

- **Backend**: Remix (Vite) + TypeScript, `@shopify/shopify-app-remix`
- **DB**: Prisma + SQLite for dev (drop-in Postgres for prod — see [Switching to Postgres](#switching-to-postgres))
- **Admin UI**: Polaris + App Bridge
- **Storefront**: Theme App Extension (one app block + one app embed + JS/CSS assets)
- **Public quote page**: App Proxy at `/apps/quote`
- **Email**: Nodemailer over SMTP (each merchant configures their own credentials)
- **Tracking**: Meta Conversions API, GA4 Measurement Protocol, Google Ads Enhanced Conversions

---

## Folder layout

```
quote-cart/
├── app/
│   ├── routes/
│   │   ├── app._index.tsx           # Dashboard
│   │   ├── app.quotes._index.tsx    # Quote list
│   │   ├── app.quotes.$id.tsx       # Quote detail
│   │   ├── app.settings.tsx         # 3-tab settings page
│   │   ├── apps.quote.tsx           # App Proxy quote page
│   │   ├── apps.quote.submit.tsx    # App Proxy submission endpoint
│   │   ├── auth.$.tsx
│   │   ├── auth.login/route.tsx
│   │   ├── webhooks.app.uninstalled.tsx
│   │   └── webhooks.app.scopes_update.tsx
│   ├── lib/
│   │   ├── crypto.server.ts         # AES-256-GCM for SMTP/CAPI/GA4 secrets
│   │   ├── email.server.ts          # Nodemailer + template engine
│   │   ├── quote.server.ts          # Quote CRUD
│   │   └── tracking.server.ts       # Meta CAPI + GA4 + Google Ads
│   ├── db.server.ts
│   └── shopify.server.ts
├── extensions/quote-cart/
│   ├── blocks/
│   │   ├── quote-button.liquid      # Product page block
│   │   └── quote-launcher.liquid    # App embed (floating icon + drawer)
│   ├── snippets/
│   │   ├── quote-popup.liquid       # Confirmation modal
│   │   └── quote-cart-navlink.liquid # Optional non-floating navbar link
│   ├── assets/
│   │   ├── quote-cart.js
│   │   ├── quote-cart.css
│   │   └── quote-tracking.js
│   └── locales/
│       ├── en.default.json
│       ├── en.default.schema.json
│       ├── bg.json
│       └── bg.schema.json
├── prisma/schema.prisma
├── shopify.app.toml
├── shopify.web.toml
└── README.md
```

---

## Prerequisites

- **Node.js**: 18.20+, 20.10+, or 21+
- **npm**: 10+
- **Shopify CLI**: 3.x (`npm i -g @shopify/cli@latest`)
- A **Shopify Partner** account and a **development store**

---

## Install

```bash
npm install
```

Generate an encryption key (used to encrypt SMTP password, Meta CAPI token, GA4 API secret at rest):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

```dotenv
DATABASE_URL="file:./dev.sqlite"
ENCRYPTION_KEY=<paste the base64 key from above>
```

> The Shopify CLI fills in `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, and `SCOPES` automatically the first time you run `shopify app dev`.

Run database migrations:

```bash
npm exec -- prisma migrate dev
```

---

## Run dev

Link the app to a Partners account (one-time):

```bash
npm run config:link
```

Then start dev:

```bash
npm run dev
```

The CLI prompts you to install the app on your dev store and starts a tunnel.

---

## App Proxy configuration

The proxy is declared in `shopify.app.toml`:

```toml
[app_proxy]
url = "https://example.com/apps/quote"
prefix = "apps"
subpath = "quote"
```

This maps:

- `https://<shop>/apps/quote` → `<your-app>/apps/quote` (the public quote page)
- `https://<shop>/apps/quote/submit` → `<your-app>/apps/quote/submit` (the submission endpoint)

Shopify HMAC-signs every proxy request and `authenticate.public.appProxy(request)` validates that.

> If you switch the proxy URL after linking, run `npm run deploy` so Shopify updates its records.

---

## Required Shopify scopes

Declared in `shopify.app.toml`:

```
read_products, write_products
```

The app reads product/variant data from the storefront via Liquid (no Storefront API call), so the scopes are minimal. `write_products` is reserved for future extensions (e.g., metafield-based "minimum quote quantity").

---

## Switching to Postgres

The Prisma schema is portable. To switch:

1. Edit `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
2. Update `DATABASE_URL` in `.env`:
   ```dotenv
   DATABASE_URL="postgresql://user:pass@host:5432/quote_cart"
   ```
3. Re-generate migrations for Postgres:
   ```bash
   rm -rf prisma/migrations
   npm exec -- prisma migrate dev --name init
   ```

No code changes are needed — JSON fields are stored as strings, prices as strings (parse with `parseFloat`), and indexes are portable.

---

## Theme App Extension setup

After your first `npm run dev`, the extension is uploaded to your dev store as a draft.

In the **Online Store → Themes → Customize** editor:

1. **Add the button block** to a product template:
   - Pick a product template, click **Add block**, choose **Add to Quote button**.
   - Configure: replace the existing Add-to-Cart button vs show alongside, label, colors, border radius.

2. **Enable the launcher app embed**:
   - In the theme editor, go to **App embeds** in the left sidebar.
   - Toggle on **Quote Cart launcher**.
   - Configure corner (top-right or bottom-right), accent color, and "hide when empty".

3. **Optional: Header navbar link** — paste this into your header section/template:
   ```liquid
   {% render 'quote-cart-navlink' %}
   ```

---

## Email configuration

In the embedded admin, go to **Settings → Email sending**:

- Sender name + sender email
- SMTP host, port, username, password (encrypted at rest with AES-256-GCM)
- Notification recipient emails (comma-separated)

Click **Send test email** to verify with a real SMTP roundtrip.

### Templates

**Settings → Email templates** ships sensible defaults in **English** and **Bulgarian**. Click "Reset to defaults" to swap. Available variables:

```
{{customer_name}}    {{customer_email}}    {{customer_phone}}
{{customer_message}} {{items_table}}        {{shop_name}}
{{quote_id}}         {{submitted_at}}
```

Each variable has a one-click insert button next to the editor; the right-hand pane shows a live preview rendered with sample data.

### Email sending behavior

- The customer always receives a confirmation. The merchant team receives a notification at every address in the recipients list (with `Reply-To` set to the customer).
- If SMTP isn't configured, the quote is **still saved**. The error surfaces on the quote detail page so you can re-send manually after fixing your SMTP settings.

---

## Conversion tracking

The quote submission is the conversion event ad platforms optimize against. We fire it both client- and server-side, sharing an `event_id` so Meta and Google can deduplicate.

### Settings → Tracking

| Field                       | Where to find it                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| Meta Pixel ID               | Events Manager → Data Sources → your pixel → Settings                                           |
| Meta CAPI access token      | Events Manager → Settings → Generate access token                                               |
| Meta test event code        | Events Manager → Test events → "Test server events" tab                                         |
| Google Ads Conversion ID    | Google Ads → Tools → Conversions → your action → Tag setup → Use Google tag → "AW-…"             |
| Google Ads Conversion Label | Same as above, the part after the slash                                                          |
| GA4 Measurement ID          | GA4 → Admin → Data Streams → your web stream → "G-…"                                            |
| GA4 API secret              | GA4 → Admin → Data Streams → your stream → Measurement Protocol API secrets → Create            |
| GTM Container ID            | Google Tag Manager → Workspace → top-right "GTM-…"                                              |

Encrypted-at-rest fields: **CAPI token**, **GA4 API secret**, and the **SMTP password**.

### Events fired

| Event                         | Where                                                | Notes                                                                                             |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `AddToQuote` / `add_to_quote` | Storefront button click (client only)                 | Pushes to `dataLayer`, fires `fbq('trackCustom','AddToQuote')` and `gtag('event','add_to_quote')` |
| `InitiateQuote`               | App Proxy quote page load (client only)              | `fbq('trackCustom','InitiateQuote')`, `dataLayer.push({event:'initiate_quote'})`                   |
| `quote_submitted` / `Lead`    | Submission success — both client AND server-side    | Shared `event_id` for dedup                                                                       |

#### Client-side (on submission success)
- `dataLayer.push({ event: 'quote_submitted', quote_id, quote_value, item_count, currency, items, eventID })`
- `fbq('track', 'Lead', { value, currency, content_ids, content_type:'product', eventID }, { eventID })`
- `fbq('trackCustom', 'QuoteSubmitted', {…})`
- `gtag('event', 'generate_lead', { value, currency, items, transaction_id, event_id })`
- `gtag('event', 'conversion', { send_to:'<id>/<label>', value, currency, transaction_id })`
- `window.dispatchEvent(new CustomEvent('quote:submitted', { detail: payload }))` — for TikTok/Pinterest/LinkedIn pixels

#### Server-side (`apps.quote.submit.tsx` → `lib/tracking.server.ts`)
- **Meta CAPI** — `event_name: 'Lead'` with SHA-256 hashed email/phone/name, `_fbp`/`_fbc` cookies forwarded, optional `test_event_code`, `event_id`, `event_source_url`, `action_source: 'website'`.
- **GA4 Measurement Protocol** — `generate_lead` with hashed user data, `client_id` extracted from the `_ga` cookie, `event_id` for dedup.
- **Google Ads Enhanced Conversions** — sent through GA4 MP `conversion` event with `send_to`, `transaction_id`, `gclid`, hashed user identifiers. Requires GA4 to be configured (industry-standard pattern for server-side enhanced conversions).

#### Capture on submit
- Client IP (from `X-Forwarded-For`)
- User agent
- `_fbp`, `_fbc`, `_ga` cookies
- `gclid` from `localStorage` (captured from URL on any page load, expires after 90 days)

#### Failure handling
A tracking failure **never** blocks the user-facing success state. Each fire is persisted as a `TrackingEvent` row (success/failed + error message) and surfaced on the quote detail page with green check / red X.

### Verifying events fire

**Meta Test Events**:
1. Set a value in **Settings → Tracking → Meta test event code** (e.g., `TEST12345`).
2. In Events Manager → Test events tab, paste the code, then submit a real quote.
3. Both the client-side `Lead` and the server-side `Lead` should appear with matching `event_id`.

**GA4 DebugView**:
1. Either install the GA Debugger Chrome extension OR add `?debug_mode=1` to your test browser URL.
2. Submit a real quote.
3. GA4 → Admin → DebugView shows `generate_lead` and `conversion` events within ~10 seconds.

**Google Ads**:
- Enhanced Conversions diagnostics: Google Ads → Tools → Conversions → your action → Diagnostics tab.
- Server-side conversions show up under "Enhanced conversions for web" within ~3 hours.

---

## Translate & Adapt compatibility

Every storefront-facing string lives in either:
- A **locale file** (`extensions/quote-cart/locales/*`)
- A **block setting** (e.g., the button label is editable per-block)

Schema labels also use the `t:` prefix so the admin UI translates too. To verify:

1. Install **Translate & Adapt** on your dev store.
2. Open a translation for Bulgarian.
3. The strings should appear under "Theme app extensions → Quote Cart" with both storefront and schema strings ready to translate. The shipped `bg.json` already provides translations for everything.

---

## Deploy to Shopify Partners

```bash
npm run deploy
```

This:
- Bundles the Remix app
- Uploads the theme app extension
- Pushes any `shopify.app.toml` changes (including App Proxy config) to your Partners app

For production, set these env vars on your host:

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://…
ENCRYPTION_KEY=<base64 32-byte key>
SHOPIFY_API_KEY=…
SHOPIFY_API_SECRET=…
SHOPIFY_APP_URL=https://your-app-host.com
SCOPES=read_products,write_products
```

Run migrations as part of your deploy:

```bash
npm run setup    # = prisma generate && prisma migrate deploy
```

---

## Local API surface

| Path                       | Auth                | Purpose                                                            |
| -------------------------- | ------------------- | ------------------------------------------------------------------ |
| `/app`                     | Embedded admin      | Dashboard                                                          |
| `/app/quotes`              | Embedded admin      | Quote list with filter & search                                    |
| `/app/quotes/:id`          | Embedded admin      | Quote detail with status, notes, tracking events                  |
| `/app/settings`            | Embedded admin      | Email + Templates + Tracking tabs                                  |
| `/apps/quote` (proxy)      | App Proxy HMAC      | Public quote page (storefront)                                     |
| `/apps/quote/submit` (proxy) | App Proxy HMAC    | Quote submission endpoint                                          |
| `/auth/...`                | Shopify             | OAuth flow                                                         |
| `/webhooks/app/uninstalled` | Webhook HMAC       | Cleans up sessions                                                 |
| `/webhooks/app/scopes_update` | Webhook HMAC     | Updates session scopes                                             |

---

## Troubleshooting

**"Add to Quote" button is disabled on the storefront**
The button auto-disables when it can't read product data. Verify the block is on a product template and that the product has at least one variant.

**Submitting the quote shows an error**
Open DevTools → Network → submit. The response JSON `error` field tells you what failed (validation, SMTP, or otherwise).

**Tracking events show ✗ on the quote detail page**
The `errorMessage` field on each `TrackingEvent` row tells you exactly what the platform returned. Common causes:
- Meta: invalid pixel ID, expired CAPI token, malformed test event code
- GA4: API secret revoked, wrong measurement ID
- Google Ads: GA4 must be configured first (server-side enhanced conversions are sent through GA4 MP)

**SMTP test fails with "self-signed cert" or similar**
Some hosts require `secure: true` on port 465 only. Try port 587 + STARTTLS first; switch to 465 if the provider requires implicit TLS. Behavior is auto-selected based on port.

**`ENCRYPTION_KEY is not set`**
Generate one (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) and put it in `.env`. The key is used by `app/lib/crypto.server.ts` to encrypt SMTP password, Meta CAPI token, and GA4 API secret.

**I rotated `ENCRYPTION_KEY` and now stored secrets are blank**
Encrypted secrets that fail to decrypt are surfaced as empty strings (this is intentional — better than crashing the page). Re-enter the affected secrets in Settings.

---

## License

MIT
