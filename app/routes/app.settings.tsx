import { useState, useMemo, useCallback, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  FormLayout,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Select,
  Tabs,
  Text,
  TextField,
  Tooltip,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_VARIABLES,
  buildPreview,
} from "../lib/email-templates";
import {
  getOrInitEmailSettings,
  sendTestEmail,
} from "../lib/email.server";
import { getOrInitTrackingSettings } from "../lib/tracking.server";
import { getOrInitOrderSettings } from "../lib/draftOrder.server";
import { encryptSecret, decryptSecret } from "../lib/crypto.server";
import {
  STOREFRONT_STRINGS,
  STRING_GROUPS,
  parseOverrides,
  type StringKey,
} from "../lib/storefront-strings";

const SECRET_PLACEHOLDER = "__KEEP_EXISTING__";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [email, tracking, orders, translations] = await Promise.all([
    getOrInitEmailSettings(session.shop),
    getOrInitTrackingSettings(session.shop),
    getOrInitOrderSettings(session.shop),
    prisma.translations.findUnique({ where: { shopDomain: session.shop } }),
  ]);
  return {
    shopDomain: session.shop,
    orders: {
      autoCreateDraft: orders.autoCreateDraft,
      autoSendInvoice: orders.autoSendInvoice,
      draftOrderTag: orders.draftOrderTag,
    },
    translations: {
      overridesEn: parseOverrides(translations?.overridesEn ?? "{}"),
      overridesBg: parseOverrides(translations?.overridesBg ?? "{}"),
    },
    email: {
      senderName: email.senderName,
      senderEmail: email.senderEmail,
      emailProvider: email.emailProvider || "smtp",
      smtpHost: email.smtpHost,
      smtpPort: email.smtpPort,
      smtpUser: email.smtpUser,
      // Never send decrypted secrets to the browser. Just signal whether they're set.
      smtpPassSet: Boolean(email.smtpPassEncrypted),
      resendApiKeySet: Boolean(email.resendApiKeyEncrypted),
      notificationEmails: email.notificationEmails,
      sendMerchantNotification: email.sendMerchantNotification,
      logoUrl: email.logoUrl,
      customerSubject: email.customerSubject || DEFAULT_TEMPLATES.en.customerSubject,
      customerBody: email.customerBody || DEFAULT_TEMPLATES.en.customerBody,
      merchantSubject: email.merchantSubject || DEFAULT_TEMPLATES.en.merchantSubject,
      merchantBody: email.merchantBody || DEFAULT_TEMPLATES.en.merchantBody,
    },
    tracking: {
      metaPixelId: tracking.metaPixelId,
      metaCapiTokenSet: Boolean(tracking.metaCapiTokenEncrypted),
      metaTestEventCode: tracking.metaTestEventCode,
      googleAdsConversionId: tracking.googleAdsConversionId,
      googleAdsConversionLabel: tracking.googleAdsConversionLabel,
      ga4MeasurementId: tracking.ga4MeasurementId,
      ga4ApiSecretSet: Boolean(tracking.ga4ApiSecretEncrypted),
      gtmContainerId: tracking.gtmContainerId,
      clientTrackingEnabled: tracking.clientTrackingEnabled,
      serverTrackingEnabled: tracking.serverTrackingEnabled,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "save_email") {
    const smtpPass = String(formData.get("smtpPass") || "");
    const resendApiKey = String(formData.get("resendApiKey") || "");
    const provider = String(formData.get("emailProvider") || "smtp");
    const data = {
      senderName: String(formData.get("senderName") || ""),
      senderEmail: String(formData.get("senderEmail") || ""),
      emailProvider: provider === "resend" ? "resend" : "smtp",
      smtpHost: String(formData.get("smtpHost") || ""),
      smtpPort: parseInt(String(formData.get("smtpPort") || "587"), 10) || 587,
      smtpUser: String(formData.get("smtpUser") || ""),
      notificationEmails: String(formData.get("notificationEmails") || ""),
      sendMerchantNotification: formData.get("sendMerchantNotification") === "on",
      logoUrl: String(formData.get("logoUrl") || ""),
    };
    // Only update secrets when the merchant typed new ones. Empty input
    // is "leave existing" so we don't accidentally wipe it on every save.
    const secretUpdates: Record<string, string> = {};
    if (smtpPass && smtpPass !== SECRET_PLACEHOLDER) {
      secretUpdates.smtpPassEncrypted = encryptSecret(smtpPass);
    }
    if (resendApiKey && resendApiKey !== SECRET_PLACEHOLDER) {
      secretUpdates.resendApiKeyEncrypted = encryptSecret(resendApiKey);
    }
    await prisma.emailSettings.upsert({
      where: { shopDomain: session.shop },
      create: {
        shopDomain: session.shop,
        ...data,
        smtpPassEncrypted: secretUpdates.smtpPassEncrypted ?? "",
        resendApiKeyEncrypted: secretUpdates.resendApiKeyEncrypted ?? "",
        customerSubject: DEFAULT_TEMPLATES.en.customerSubject,
        customerBody: DEFAULT_TEMPLATES.en.customerBody,
        merchantSubject: DEFAULT_TEMPLATES.en.merchantSubject,
        merchantBody: DEFAULT_TEMPLATES.en.merchantBody,
      },
      update: { ...data, ...secretUpdates },
    });
    return json({ ok: true, intent });
  }

  if (intent === "save_templates") {
    const data = {
      customerSubject: String(formData.get("customerSubject") || ""),
      customerBody: String(formData.get("customerBody") || ""),
      merchantSubject: String(formData.get("merchantSubject") || ""),
      merchantBody: String(formData.get("merchantBody") || ""),
    };
    await prisma.emailSettings.upsert({
      where: { shopDomain: session.shop },
      create: { shopDomain: session.shop, ...data },
      update: data,
    });
    return json({ ok: true, intent });
  }

  if (intent === "save_tracking") {
    const capiToken = String(formData.get("metaCapiToken") || "");
    const ga4Secret = String(formData.get("ga4ApiSecret") || "");
    const data = {
      metaPixelId: String(formData.get("metaPixelId") || ""),
      metaTestEventCode: String(formData.get("metaTestEventCode") || ""),
      googleAdsConversionId: String(formData.get("googleAdsConversionId") || ""),
      googleAdsConversionLabel: String(formData.get("googleAdsConversionLabel") || ""),
      ga4MeasurementId: String(formData.get("ga4MeasurementId") || ""),
      gtmContainerId: String(formData.get("gtmContainerId") || ""),
      clientTrackingEnabled: formData.get("clientTrackingEnabled") === "on",
      serverTrackingEnabled: formData.get("serverTrackingEnabled") === "on",
    };
    const capiUpdate =
      capiToken && capiToken !== SECRET_PLACEHOLDER
        ? { metaCapiTokenEncrypted: encryptSecret(capiToken) }
        : {};
    const ga4Update =
      ga4Secret && ga4Secret !== SECRET_PLACEHOLDER
        ? { ga4ApiSecretEncrypted: encryptSecret(ga4Secret) }
        : {};
    await prisma.trackingSettings.upsert({
      where: { shopDomain: session.shop },
      create: { shopDomain: session.shop, ...data, ...capiUpdate, ...ga4Update },
      update: { ...data, ...capiUpdate, ...ga4Update },
    });
    return json({ ok: true, intent });
  }

  if (intent === "test_email") {
    const to = String(formData.get("to") || "");
    if (!to) return json({ ok: false, intent, error: "Provide an address." });
    const result = await sendTestEmail(session.shop, to);
    if (!result.ok) return json({ ok: false, intent, error: result.error });
    return json({ ok: true, intent, message: `Sent to ${to}.` });
  }

  if (intent === "save_translations") {
    // Pull every known string key out of the form, build per-lang JSON.
    const enOverrides: Record<string, string> = {};
    const bgOverrides: Record<string, string> = {};
    for (const desc of STOREFRONT_STRINGS) {
      const en = String(formData.get(`en::${desc.key}`) || "").trim();
      const bg = String(formData.get(`bg::${desc.key}`) || "").trim();
      if (en) enOverrides[desc.key] = en;
      if (bg) bgOverrides[desc.key] = bg;
    }
    await prisma.translations.upsert({
      where: { shopDomain: session.shop },
      create: {
        shopDomain: session.shop,
        overridesEn: JSON.stringify(enOverrides),
        overridesBg: JSON.stringify(bgOverrides),
      },
      update: {
        overridesEn: JSON.stringify(enOverrides),
        overridesBg: JSON.stringify(bgOverrides),
      },
    });
    return json({ ok: true, intent });
  }

  if (intent === "reset_translations") {
    await prisma.translations.upsert({
      where: { shopDomain: session.shop },
      create: { shopDomain: session.shop },
      update: { overridesEn: "{}", overridesBg: "{}" },
    });
    return json({ ok: true, intent });
  }

  if (intent === "save_orders") {
    const data = {
      autoCreateDraft: formData.get("autoCreateDraft") === "on",
      autoSendInvoice: formData.get("autoSendInvoice") === "on",
      draftOrderTag: String(formData.get("draftOrderTag") || "quote-cart").trim() || "quote-cart",
    };
    await prisma.orderSettings.upsert({
      where: { shopDomain: session.shop },
      create: { shopDomain: session.shop, ...data },
      update: data,
    });
    return json({ ok: true, intent });
  }

  if (intent === "reset_templates") {
    const lang = String(formData.get("lang") || "en") as "en" | "bg";
    const t = DEFAULT_TEMPLATES[lang] || DEFAULT_TEMPLATES.en;
    await prisma.emailSettings.upsert({
      where: { shopDomain: session.shop },
      create: { shopDomain: session.shop, ...t },
      update: t,
    });
    return json({ ok: true, intent });
  }

  // Unknown intent — verify the secret hasn't been swapped.
  // The decrypt is just to keep an unused import warning at bay if all branches go cold.
  void decryptSecret;
  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const [tab, setTab] = useState(0);

  return (
    <Page title="Settings">
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <Tabs
              selected={tab}
              onSelect={setTab}
              tabs={[
                { id: "email", content: "Email sending" },
                { id: "templates", content: "Email templates" },
                { id: "tracking", content: "Tracking" },
                { id: "orders", content: "Shopify orders" },
                { id: "translations", content: "Translations" },
              ]}
            />
            <Divider />
            <Box padding="400">
              {tab === 0 && <EmailTab email={data.email} />}
              {tab === 1 && <TemplatesTab email={data.email} shopDomain={data.shopDomain} />}
              {tab === 2 && <TrackingTab tracking={data.tracking} />}
              {tab === 3 && <OrdersTab orders={data.orders} />}
              {tab === 4 && <TranslationsTab translations={data.translations} />}
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function EmailTab({ email }: { email: ReturnType<typeof useLoaderData<typeof loader>>["email"] }) {
  const fetcher = useFetcher<{ ok: boolean; intent?: string; error?: string }>();
  const testFetcher = useFetcher<{ ok: boolean; intent?: string; error?: string; message?: string }>();

  const [senderName, setSenderName] = useState(email.senderName);
  const [senderEmail, setSenderEmail] = useState(email.senderEmail);
  const [emailProvider, setEmailProvider] = useState(email.emailProvider || "smtp");
  const [smtpHost, setSmtpHost] = useState(email.smtpHost);
  const [smtpPort, setSmtpPort] = useState(String(email.smtpPort));
  const [smtpUser, setSmtpUser] = useState(email.smtpUser);
  const [smtpPass, setSmtpPass] = useState("");
  const [resendApiKey, setResendApiKey] = useState("");
  const [notificationEmails, setNotificationEmails] = useState(email.notificationEmails);
  const [sendMerchantNotification, setSendMerchantNotification] = useState(
    email.sendMerchantNotification,
  );
  const [logoUrl, setLogoUrl] = useState(email.logoUrl || "");
  const [testTo, setTestTo] = useState("");

  const isSaving = fetcher.state !== "idle";
  const isTesting = testFetcher.state !== "idle";

  return (
    <BlockStack gap="500">
      {fetcher.data?.ok && fetcher.data.intent === "save_email" && (
        <Banner tone="success" title="Email settings saved." onDismiss={() => {}} />
      )}
      {fetcher.data && !fetcher.data.ok && fetcher.data.error && (
        <Banner tone="critical" title="Save failed">{fetcher.data.error}</Banner>
      )}

      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="save_email" />
        <FormLayout>
          <FormLayout.Group>
            <TextField
              label="Sender name"
              name="senderName"
              value={senderName}
              onChange={setSenderName}
              autoComplete="off"
            />
            <TextField
              label="Sender email"
              name="senderEmail"
              type="email"
              value={senderEmail}
              onChange={setSenderEmail}
              autoComplete="off"
              helpText={
                emailProvider === "resend"
                  ? "Use onboarding@resend.dev for testing. Verify a domain in Resend to send from your real address."
                  : ""
              }
            />
          </FormLayout.Group>

          <Select
            label="Sending method"
            name="emailProvider"
            value={emailProvider}
            onChange={setEmailProvider}
            options={[
              { label: "Resend (HTTP API) — recommended for cloud-hosted apps", value: "resend" },
              { label: "SMTP (Gmail, custom server, etc.)", value: "smtp" },
            ]}
            helpText={
              emailProvider === "resend"
                ? "Goes through HTTPS to api.resend.com. Bypasses host firewalls that block SMTP."
                : "Direct SMTP connection. Some hosts (Railway, Render) block outbound SMTP — switch to Resend if connections time out."
            }
          />

          {emailProvider === "resend" ? (
            <TextField
              label="Resend API key"
              name="resendApiKey"
              type="password"
              value={resendApiKey}
              onChange={setResendApiKey}
              placeholder={email.resendApiKeySet ? "•••••••• (saved — type to replace)" : "re_..."}
              autoComplete="new-password"
              helpText={
                email.resendApiKeySet
                  ? "Leave blank to keep the existing key. Encrypted at rest."
                  : "Get one at resend.com → API Keys. Encrypted at rest with AES-256-GCM."
              }
            />
          ) : (
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">SMTP</Text>
              <FormLayout.Group>
                <TextField
                  label="Host"
                  name="smtpHost"
                  value={smtpHost}
                  onChange={setSmtpHost}
                  placeholder="smtp.example.com"
                  autoComplete="off"
                />
                <TextField
                  label="Port"
                  name="smtpPort"
                  type="number"
                  value={smtpPort}
                  onChange={setSmtpPort}
                  autoComplete="off"
                />
              </FormLayout.Group>
              <FormLayout.Group>
                <TextField
                  label="Username"
                  name="smtpUser"
                  value={smtpUser}
                  onChange={setSmtpUser}
                  autoComplete="off"
                />
                <TextField
                  label="Password"
                  name="smtpPass"
                  type="password"
                  value={smtpPass}
                  onChange={setSmtpPass}
                  placeholder={email.smtpPassSet ? "•••••••• (saved — type to replace)" : ""}
                  autoComplete="new-password"
                  helpText={
                    email.smtpPassSet
                      ? "Leave blank to keep the existing password. Encrypted at rest."
                      : "Encrypted at rest with AES-256-GCM."
                  }
                />
              </FormLayout.Group>
            </BlockStack>
          )}

          <Divider />

          <Text as="h3" variant="headingSm">Branding</Text>
          <TextField
            label="Logo URL (optional)"
            name="logoUrl"
            type="url"
            value={logoUrl}
            onChange={setLogoUrl}
            placeholder="https://yourstore.com/logo.png"
            autoComplete="off"
            helpText="Shown at the top of every HTML email. Hosted somewhere public — easiest is to upload to Shopify Files (Content → Files) and copy the URL."
          />

          <Divider />

          <Text as="h3" variant="headingSm">Merchant notification</Text>
          <Checkbox
            label="Send a notification email to me when a customer submits a quote"
            name="sendMerchantNotification"
            checked={sendMerchantNotification}
            onChange={setSendMerchantNotification}
            helpText="Off = only the customer gets a confirmation. You'll still see every quote in the dashboard."
          />
          {sendMerchantNotification && (
            <TextField
              label="Notification recipients"
              name="notificationEmails"
              value={notificationEmails}
              onChange={setNotificationEmails}
              placeholder="sales@example.com, ops@example.com"
              helpText="Comma-separated. Each address gets the merchant notification when a quote comes in."
              autoComplete="off"
            />
          )}
          {!sendMerchantNotification && (
            <input type="hidden" name="notificationEmails" value={notificationEmails} />
          )}

          <InlineStack gap="200">
            <Button submit variant="primary" loading={isSaving}>
              Save email settings
            </Button>
          </InlineStack>
        </FormLayout>
      </fetcher.Form>

      <Divider />

      <BlockStack gap="200">
        <Text as="h3" variant="headingSm">
          Send test email
        </Text>
        <Text as="p" tone="subdued" variant="bodySm">
          Save your settings first, then send a test through the configured provider.
        </Text>
        {testFetcher.data?.ok && testFetcher.data.message && (
          <Banner tone="success">{testFetcher.data.message}</Banner>
        )}
        {testFetcher.data && !testFetcher.data.ok && testFetcher.data.error && (
          <Banner tone="critical" title="Test failed">{testFetcher.data.error}</Banner>
        )}
        <testFetcher.Form method="post">
          <input type="hidden" name="intent" value="test_email" />
          <InlineStack gap="200" align="start" blockAlign="end">
            <Box minWidth="320px">
              <TextField
                label="Recipient"
                name="to"
                type="email"
                value={testTo}
                onChange={setTestTo}
                placeholder="you@example.com"
                autoComplete="off"
              />
            </Box>
            <Button submit loading={isTesting} disabled={!testTo}>
              Send test email
            </Button>
          </InlineStack>
        </testFetcher.Form>
      </BlockStack>
    </BlockStack>
  );
}

function TemplatesTab({
  email,
  shopDomain,
}: {
  email: ReturnType<typeof useLoaderData<typeof loader>>["email"];
  shopDomain: string;
}) {
  const fetcher = useFetcher<{ ok: boolean; intent?: string }>();
  const resetFetcher = useFetcher();

  const [customerSubject, setCustomerSubject] = useState(email.customerSubject);
  const [customerBody, setCustomerBody] = useState(email.customerBody);
  const [merchantSubject, setMerchantSubject] = useState(email.merchantSubject);
  const [merchantBody, setMerchantBody] = useState(email.merchantBody);

  const customerPreview = useMemo(
    () => buildPreview({ subject: customerSubject, body: customerBody }, shopDomain),
    [customerSubject, customerBody, shopDomain],
  );
  const merchantPreview = useMemo(
    () => buildPreview({ subject: merchantSubject, body: merchantBody }, shopDomain),
    [merchantSubject, merchantBody, shopDomain],
  );

  const insert = useCallback((variable: string, target: "customerBody" | "merchantBody") => {
    const setter = target === "customerBody" ? setCustomerBody : setMerchantBody;
    setter((prev) => `${prev}{{${variable}}}`);
  }, []);

  return (
    <BlockStack gap="500">
      {fetcher.data?.ok && (
        <Banner tone="success" title="Templates saved." onDismiss={() => {}} />
      )}

      <InlineGrid columns={{ xs: 1, lg: "2fr 1fr" }} gap="400">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="save_templates" />
          <BlockStack gap="500">
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Customer confirmation
                </Text>
                <TextField
                  label="Subject"
                  name="customerSubject"
                  value={customerSubject}
                  onChange={setCustomerSubject}
                  autoComplete="off"
                />
                <MarkdownEditor
                  label="Body"
                  name="customerBody"
                  value={customerBody}
                  onChange={setCustomerBody}
                  rows={12}
                />
                <VarChips onInsert={(v) => insert(v, "customerBody")} />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Merchant notification
                </Text>
                <TextField
                  label="Subject"
                  name="merchantSubject"
                  value={merchantSubject}
                  onChange={setMerchantSubject}
                  autoComplete="off"
                />
                <MarkdownEditor
                  label="Body"
                  name="merchantBody"
                  value={merchantBody}
                  onChange={setMerchantBody}
                  rows={12}
                />
                <VarChips onInsert={(v) => insert(v, "merchantBody")} />
              </BlockStack>
            </Card>

            <InlineStack gap="200">
              <Button submit variant="primary" loading={fetcher.state !== "idle"}>
                Save templates
              </Button>
              <resetFetcher.Form method="post" style={{ display: "inline-block" }}>
                <input type="hidden" name="intent" value="reset_templates" />
                <input type="hidden" name="lang" value="en" />
                <Button submit>Reset to defaults</Button>
              </resetFetcher.Form>
            </InlineStack>
          </BlockStack>
        </fetcher.Form>

        <BlockStack gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Live preview — Customer
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Subject
              </Text>
              <Text as="p" fontWeight="semibold">{customerPreview.subject}</Text>
              <Divider />
              <PreviewBody body={customerPreview.body} />
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Live preview — Merchant
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Subject
              </Text>
              <Text as="p" fontWeight="semibold">{merchantPreview.subject}</Text>
              <Divider />
              <PreviewBody body={merchantPreview.body} />
            </BlockStack>
          </Card>
        </BlockStack>
      </InlineGrid>
    </BlockStack>
  );
}

function MarkdownEditor({
  label,
  name,
  value,
  onChange,
  rows = 10,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const surround = useCallback(
    (before: string, after = "") => {
      const ta = ref.current;
      if (!ta) {
        onChange(`${value}${before}${after}`);
        return;
      }
      const start = ta.selectionStart ?? value.length;
      const end = ta.selectionEnd ?? value.length;
      const selected = value.slice(start, end);
      const next = value.slice(0, start) + before + selected + after + value.slice(end);
      onChange(next);
      // Restore selection / cursor inside the just-inserted markup.
      requestAnimationFrame(() => {
        ta.focus();
        const cursor = start + before.length + selected.length;
        ta.setSelectionRange(cursor, cursor);
      });
    },
    [onChange, value],
  );

  const prependLine = useCallback(
    (prefix: string) => {
      const ta = ref.current;
      if (!ta) {
        onChange(`${prefix}${value}`);
        return;
      }
      const start = ta.selectionStart ?? 0;
      // Find the start of the current line.
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
      onChange(next);
      requestAnimationFrame(() => {
        ta.focus();
        const cursor = start + prefix.length;
        ta.setSelectionRange(cursor, cursor);
      });
    },
    [onChange, value],
  );

  const insertLink = useCallback(() => {
    const url = window.prompt("Link URL (https://...):");
    if (!url) return;
    surround("[", `](${url})`);
  }, [surround]);

  const insertImage = useCallback(() => {
    const url = window.prompt(
      "Image URL (https://...):\nUpload to Shopify Admin → Content → Files → copy URL.",
    );
    if (!url) return;
    surround(`![image](${url})`, "");
  }, [surround]);

  return (
    <div>
      <label
        htmlFor={`md-${name}`}
        style={{
          display: "block",
          fontSize: 13,
          fontWeight: 500,
          color: "var(--p-color-text)",
          marginBottom: 4,
        }}
      >
        {label}
      </label>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          padding: "6px 8px",
          background: "#f6f6f7",
          border: "1px solid #d0d0d0",
          borderBottom: "0",
          borderRadius: "8px 8px 0 0",
        }}
      >
        <ToolbarBtn label="B" title="Bold (Ctrl/Cmd+B)" onClick={() => surround("**", "**")} bold />
        <ToolbarBtn label="I" title="Italic (Ctrl/Cmd+I)" onClick={() => surround("*", "*")} italic />
        <ToolbarSep />
        <ToolbarBtn label="H1" title="Heading 1" onClick={() => prependLine("# ")} />
        <ToolbarBtn label="H2" title="Heading 2" onClick={() => prependLine("## ")} />
        <ToolbarBtn label="H3" title="Heading 3" onClick={() => prependLine("### ")} />
        <ToolbarSep />
        <ToolbarBtn label="•" title="Bulleted list" onClick={() => prependLine("- ")} />
        <ToolbarSep />
        <ToolbarBtn label="🔗" title="Insert link" onClick={insertLink} />
        <ToolbarBtn label="🖼" title="Insert image (paste URL)" onClick={insertImage} />
        <ToolbarSep />
        <ToolbarBtn
          label="—"
          title="Horizontal rule"
          onClick={() => surround("\n\n---\n\n")}
        />
      </div>
      <textarea
        id={`md-${name}`}
        ref={ref}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
            e.preventDefault();
            surround("**", "**");
          }
          if ((e.metaKey || e.ctrlKey) && (e.key === "i" || e.key === "I")) {
            e.preventDefault();
            surround("*", "*");
          }
        }}
        rows={rows}
        spellCheck
        autoComplete="off"
        style={{
          width: "100%",
          padding: "10px 12px",
          border: "1px solid #d0d0d0",
          borderRadius: "0 0 8px 8px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          lineHeight: 1.55,
          resize: "vertical",
          outline: "none",
          boxSizing: "border-box",
          background: "white",
          color: "#1f1f1f",
        }}
      />
      <div style={{ marginTop: 4, fontSize: 12, color: "#6b7177" }}>
        Markdown: <code>**bold**</code> · <code>*italic*</code> · <code># heading</code> ·{" "}
        <code>[text](url)</code> · <code>![alt](url)</code>. Plain text also works.
      </div>
    </div>
  );
}

function ToolbarBtn({
  label,
  title,
  onClick,
  bold,
  italic,
}: {
  label: string;
  title: string;
  onClick: () => void;
  bold?: boolean;
  italic?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        background: "white",
        border: "1px solid #d0d0d0",
        borderRadius: 6,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: bold ? 700 : 500,
        fontStyle: italic ? "italic" : "normal",
        cursor: "pointer",
        color: "#1f1f1f",
        minWidth: 30,
        height: 28,
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );
}

function ToolbarSep() {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 1,
        background: "#d0d0d0",
        margin: "2px 4px",
      }}
    />
  );
}

function VarChips({ onInsert }: { onInsert: (v: string) => void }) {
  return (
    <BlockStack gap="100">
      <Text as="p" variant="bodySm" tone="subdued">
        Click a variable to insert. Available: {TEMPLATE_VARIABLES.length}.
      </Text>
      <InlineStack gap="100" wrap>
        {TEMPLATE_VARIABLES.map((v) => (
          <Tooltip key={v} content={`Insert {{${v}}}`}>
            <Button size="micro" onClick={() => onInsert(v)}>
              {`{{${v}}}`}
            </Button>
          </Tooltip>
        ))}
      </InlineStack>
    </BlockStack>
  );
}

function PreviewBody({ body }: { body: string }) {
  return (
    <Box
      background="bg-surface-secondary"
      padding="300"
      borderRadius="200"
    >
      <pre
        style={{
          margin: 0,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          color: "#1f1f1f",
        }}
      >
        {body}
      </pre>
    </Box>
  );
}

function TrackingTab({
  tracking,
}: {
  tracking: ReturnType<typeof useLoaderData<typeof loader>>["tracking"];
}) {
  const fetcher = useFetcher<{ ok: boolean; intent?: string }>();
  const [metaPixelId, setMetaPixelId] = useState(tracking.metaPixelId);
  const [metaCapiToken, setMetaCapiToken] = useState("");
  const [metaTestEventCode, setMetaTestEventCode] = useState(tracking.metaTestEventCode);
  const [googleAdsConversionId, setGoogleAdsConversionId] = useState(tracking.googleAdsConversionId);
  const [googleAdsConversionLabel, setGoogleAdsConversionLabel] = useState(tracking.googleAdsConversionLabel);
  const [ga4MeasurementId, setGa4MeasurementId] = useState(tracking.ga4MeasurementId);
  const [ga4ApiSecret, setGa4ApiSecret] = useState("");
  const [gtmContainerId, setGtmContainerId] = useState(tracking.gtmContainerId);
  const [clientTrackingEnabled, setClientTrackingEnabled] = useState(tracking.clientTrackingEnabled);
  const [serverTrackingEnabled, setServerTrackingEnabled] = useState(tracking.serverTrackingEnabled);

  return (
    <BlockStack gap="400">
      {fetcher.data?.ok && fetcher.data.intent === "save_tracking" && (
        <Banner tone="success" title="Tracking settings saved." onDismiss={() => {}} />
      )}
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="save_tracking" />
        <BlockStack gap="500">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Meta (Facebook + Instagram)</Text>
              <FormLayout.Group>
                <TextField
                  label="Pixel ID"
                  name="metaPixelId"
                  value={metaPixelId}
                  onChange={setMetaPixelId}
                  autoComplete="off"
                />
                <TextField
                  label="Test event code"
                  name="metaTestEventCode"
                  value={metaTestEventCode}
                  onChange={setMetaTestEventCode}
                  helpText="Optional. From Events Manager → Test events. Routes server-side fires there for verification."
                  autoComplete="off"
                />
              </FormLayout.Group>
              <TextField
                label="Conversions API access token"
                name="metaCapiToken"
                type="password"
                value={metaCapiToken}
                onChange={setMetaCapiToken}
                placeholder={tracking.metaCapiTokenSet ? "•••••••• (saved — type to replace)" : ""}
                helpText={
                  tracking.metaCapiTokenSet
                    ? "Leave blank to keep the existing token."
                    : "From Events Manager → Settings → Generate access token. Encrypted at rest."
                }
                autoComplete="new-password"
              />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Google Ads</Text>
              <FormLayout.Group>
                <TextField
                  label="Conversion ID"
                  name="googleAdsConversionId"
                  value={googleAdsConversionId}
                  onChange={setGoogleAdsConversionId}
                  placeholder="AW-1234567890"
                  autoComplete="off"
                />
                <TextField
                  label="Conversion label"
                  name="googleAdsConversionLabel"
                  value={googleAdsConversionLabel}
                  onChange={setGoogleAdsConversionLabel}
                  placeholder="abcDEFghi-jKL"
                  autoComplete="off"
                />
              </FormLayout.Group>
              <Text as="p" variant="bodySm" tone="subdued">
                Server-side enhanced conversions are sent through GA4 Measurement Protocol — configure GA4 below to enable them.
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Google Analytics 4</Text>
              <FormLayout.Group>
                <TextField
                  label="Measurement ID"
                  name="ga4MeasurementId"
                  value={ga4MeasurementId}
                  onChange={setGa4MeasurementId}
                  placeholder="G-XXXXXXX"
                  autoComplete="off"
                />
                <TextField
                  label="API secret"
                  name="ga4ApiSecret"
                  type="password"
                  value={ga4ApiSecret}
                  onChange={setGa4ApiSecret}
                  placeholder={tracking.ga4ApiSecretSet ? "•••••••• (saved — type to replace)" : ""}
                  helpText={
                    tracking.ga4ApiSecretSet
                      ? "Leave blank to keep the existing secret."
                      : "From GA4 → Admin → Data Streams → Measurement Protocol API secrets. Encrypted at rest."
                  }
                  autoComplete="new-password"
                />
              </FormLayout.Group>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Google Tag Manager</Text>
              <TextField
                label="Container ID"
                name="gtmContainerId"
                value={gtmContainerId}
                onChange={setGtmContainerId}
                placeholder="GTM-XXXXXX"
                helpText="Optional. dataLayer events fire regardless — this is just for visibility."
                autoComplete="off"
              />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Toggles</Text>
              <Checkbox
                label="Client-side tracking enabled"
                name="clientTrackingEnabled"
                checked={clientTrackingEnabled}
                onChange={setClientTrackingEnabled}
                helpText="Push to dataLayer, fire fbq + gtag on quote submission."
              />
              <Checkbox
                label="Server-side tracking enabled"
                name="serverTrackingEnabled"
                checked={serverTrackingEnabled}
                onChange={setServerTrackingEnabled}
                helpText="Send Meta CAPI, GA4 MP, and Google Ads enhanced conversions from the server."
              />
            </BlockStack>
          </Card>

          <InlineStack gap="200">
            <Button submit variant="primary" loading={fetcher.state !== "idle"}>
              Save tracking settings
            </Button>
          </InlineStack>
        </BlockStack>
      </fetcher.Form>
    </BlockStack>
  );
}

function OrdersTab({
  orders,
}: {
  orders: ReturnType<typeof useLoaderData<typeof loader>>["orders"];
}) {
  const fetcher = useFetcher<{ ok: boolean; intent?: string }>();
  const [autoCreateDraft, setAutoCreateDraft] = useState(orders.autoCreateDraft);
  const [autoSendInvoice, setAutoSendInvoice] = useState(orders.autoSendInvoice);
  const [draftOrderTag, setDraftOrderTag] = useState(orders.draftOrderTag);

  return (
    <BlockStack gap="500">
      {fetcher.data?.ok && fetcher.data.intent === "save_orders" && (
        <Banner tone="success" title="Order settings saved." onDismiss={() => {}} />
      )}

      <Banner tone="info" title="How it works">
        <p>
          When a customer submits a quote, you can have Quote Cart automatically
          create a Shopify <strong>draft order</strong> for it — or just keep
          the manual button on the quote detail page. Either way, the original
          quote stays in this app for your records.
        </p>
        <p>
          Draft orders show up under <strong>Shopify Admin → Orders → Drafts</strong>.
          Once you finalize pricing and the customer pays, the draft becomes a
          real Order with all the standard reporting and fulfillment.
        </p>
      </Banner>

      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="save_orders" />
        <BlockStack gap="500">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                Automation
              </Text>
              <Checkbox
                label="Auto-create a Shopify draft order on every quote submission"
                name="autoCreateDraft"
                checked={autoCreateDraft}
                onChange={setAutoCreateDraft}
                helpText="When off, a draft order is only created if you click 'Create draft order' on the quote detail page."
              />
              <Checkbox
                label="Send the Shopify invoice email to the customer when the draft is created"
                name="autoSendInvoice"
                checked={autoSendInvoice}
                onChange={setAutoSendInvoice}
                disabled={!autoCreateDraft}
                helpText={
                  autoCreateDraft
                    ? "Customer gets a Shopify-generated payment link by email. Useful if your prices are fixed at submission time."
                    : "Enable auto-create above to use this."
                }
              />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                Draft order tag
              </Text>
              <TextField
                label="Tag applied to every draft order created from a quote"
                labelHidden
                name="draftOrderTag"
                value={draftOrderTag}
                onChange={setDraftOrderTag}
                placeholder="quote-cart"
                autoComplete="off"
                helpText="Useful for filtering in Shopify Admin → Orders → Drafts. Leave as 'quote-cart' or pick your own tag."
              />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Required permissions
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                The app needs <code>write_draft_orders</code>, <code>read_customers</code>,
                and <code>write_customers</code> scopes to create draft orders.
                If you installed the app before these were added, Shopify will prompt
                you to re-approve when you trigger the first draft order.
              </Text>
            </BlockStack>
          </Card>

          <InlineStack gap="200">
            <Button submit variant="primary" loading={fetcher.state !== "idle"}>
              Save order settings
            </Button>
          </InlineStack>
        </BlockStack>
      </fetcher.Form>
    </BlockStack>
  );
}

function TranslationsTab({
  translations,
}: {
  translations: ReturnType<typeof useLoaderData<typeof loader>>["translations"];
}) {
  const fetcher = useFetcher<{ ok: boolean; intent?: string }>();
  const resetFetcher = useFetcher<{ ok: boolean; intent?: string }>();

  // Local state per key per language. Empty string = use shipped default.
  const [enValues, setEnValues] = useState<Record<string, string>>(
    () => translations.overridesEn as Record<string, string>,
  );
  const [bgValues, setBgValues] = useState<Record<string, string>>(
    () => translations.overridesBg as Record<string, string>,
  );

  return (
    <BlockStack gap="500">
      {fetcher.data?.ok && fetcher.data.intent === "save_translations" && (
        <Banner tone="success" title="Translations saved." onDismiss={() => {}} />
      )}
      {resetFetcher.data?.ok && resetFetcher.data.intent === "reset_translations" && (
        <Banner tone="success" title="Reset to shipped defaults." onDismiss={() => {}} />
      )}

      <Banner tone="info" title="How it works">
        <p>
          Override any storefront string here. Leave a field blank to use the
          default Quote Cart ships with. Changes apply on the storefront within
          ~60 seconds (we cache the override script for one minute).
        </p>
        <p>
          The fields below replace the strings rendered in the button block,
          confirmation popup, slide-in drawer, and floating launcher. Email
          templates are edited separately under the Email templates tab.
        </p>
      </Banner>

      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="save_translations" />
        <BlockStack gap="500">
          {STRING_GROUPS.map((group) => {
            const groupStrings = STOREFRONT_STRINGS.filter((s) => s.group === group);
            return (
              <Card key={group}>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingSm">
                    {group}
                  </Text>
                  {groupStrings.map((s) => (
                    <BlockStack key={s.key} gap="200">
                      <InlineStack gap="200" blockAlign="baseline" wrap={false}>
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          {s.label}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          <code>{s.key}</code>
                        </Text>
                      </InlineStack>
                      <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                        <TextField
                          label="English"
                          name={`en::${s.key}`}
                          value={enValues[s.key] ?? ""}
                          onChange={(v) =>
                            setEnValues((prev) => ({ ...prev, [s.key]: v }))
                          }
                          placeholder={s.defaultEn}
                          autoComplete="off"
                          helpText={
                            (enValues[s.key] ?? "").trim()
                              ? `Overriding default: "${s.defaultEn}"`
                              : `Default: "${s.defaultEn}"`
                          }
                        />
                        <TextField
                          label="Bulgarian"
                          name={`bg::${s.key}`}
                          value={bgValues[s.key] ?? ""}
                          onChange={(v) =>
                            setBgValues((prev) => ({ ...prev, [s.key]: v }))
                          }
                          placeholder={s.defaultBg}
                          autoComplete="off"
                          helpText={
                            (bgValues[s.key] ?? "").trim()
                              ? `Overriding default: "${s.defaultBg}"`
                              : `Default: "${s.defaultBg}"`
                          }
                        />
                      </InlineGrid>
                    </BlockStack>
                  ))}
                </BlockStack>
              </Card>
            );
          })}

          <InlineStack gap="200">
            <Button submit variant="primary" loading={fetcher.state !== "idle"}>
              Save translations
            </Button>
            <resetFetcher.Form method="post" style={{ display: "inline-block" }}>
              <input type="hidden" name="intent" value="reset_translations" />
              <Button submit loading={resetFetcher.state !== "idle"}>
                Reset all to defaults
              </Button>
            </resetFetcher.Form>
          </InlineStack>
        </BlockStack>
      </fetcher.Form>
    </BlockStack>
  );
}
