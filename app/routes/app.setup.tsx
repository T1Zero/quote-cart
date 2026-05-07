import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link as RemixLink, useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Layout,
  Link,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrInitEmailSettings } from "../lib/email.server";
import { getOrInitTrackingSettings } from "../lib/tracking.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [email, tracking, quoteCount] = await Promise.all([
    getOrInitEmailSettings(session.shop),
    getOrInitTrackingSettings(session.shop),
    prisma.quote.count({ where: { shopDomain: session.shop } }),
  ]);
  return {
    shopDomain: session.shop,
    status: {
      emailConfigured: Boolean(
        email.smtpHost && email.smtpUser && email.smtpPassEncrypted,
      ),
      notificationsConfigured: Boolean(email.notificationEmails?.trim()),
      trackingConfigured: Boolean(
        tracking.metaPixelId ||
          tracking.ga4MeasurementId ||
          tracking.googleAdsConversionId,
      ),
      hasQuotes: quoteCount > 0,
    },
  };
};

export default function SetupPage() {
  const { shopDomain, status } = useLoaderData<typeof loader>();
  const themeEditorUrl = `https://${shopDomain}/admin/themes/current/editor`;

  const checks = [
    { label: "Add the Add-to-Quote button to product pages", done: false },
    { label: "Add the basket icon to your header", done: false },
    { label: "Configure SMTP and notification recipients", done: status.emailConfigured && status.notificationsConfigured },
    { label: "Configure ad tracking (Meta / GA4 / Google Ads)", done: status.trackingConfigured },
    { label: "Submit a test quote on the storefront", done: status.hasQuotes },
  ];

  const allDone = checks.every((c) => c.done);

  return (
    <Page
      title="Setup guide"
      subtitle="Get Quote Cart running on your storefront in a few minutes."
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {allDone ? (
              <Banner tone="success" title="You're all set up.">
                <p>
                  Quote Cart is running. You can revisit this page any time to
                  reference instructions.
                </p>
              </Banner>
            ) : (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Progress
                  </Text>
                  <List type="bullet">
                    {checks.map((c, i) => (
                      <List.Item key={i}>
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodyMd">
                            {c.done ? "✅" : "⬜️"} {c.label}
                          </Text>
                          {c.done ? (
                            <Badge tone="success">Done</Badge>
                          ) : (
                            <Badge>Pending</Badge>
                          )}
                        </InlineStack>
                      </List.Item>
                    ))}
                  </List>
                </BlockStack>
              </Card>
            )}

            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="info">Step 1</Badge>
                  <Text as="h2" variant="headingMd">
                    Add the Add-to-Quote button to product pages
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodyMd">
                  This is the button customers click to add a product to their
                  quote instead of buying it directly.
                </Text>
                <List type="number">
                  <List.Item>
                    Click <strong>Open theme editor</strong> below.
                  </List.Item>
                  <List.Item>
                    In the top dropdown, switch from "Home page" to{" "}
                    <strong>Products → Default product</strong>.
                  </List.Item>
                  <List.Item>
                    In the left rail, find the <strong>Product information</strong>{" "}
                    section (or whatever holds your existing Add-to-Cart button) →
                    click <strong>+ Add block</strong>.
                  </List.Item>
                  <List.Item>
                    Under the <strong>Apps</strong> group, pick{" "}
                    <strong>Add to Quote button</strong>.
                  </List.Item>
                  <List.Item>
                    Drag the new block where you want it. With "Replace existing
                    Add-to-Cart" checked, the native button hides automatically.
                  </List.Item>
                  <List.Item>
                    Tweak the block settings (button label, colors, border
                    radius, quantity selector toggle) on the right panel.
                  </List.Item>
                  <List.Item>
                    Click <strong>Save</strong> in the top-right.
                  </List.Item>
                </List>
                <InlineStack gap="200">
                  <Button url={themeEditorUrl} target="_blank" variant="primary">
                    Open theme editor
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="info">Step 2</Badge>
                  <Text as="h2" variant="headingMd">
                    Add the basket icon to your header
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodyMd">
                  Lets customers open their quote from any page, with a count
                  badge that updates in real time.
                </Text>
                <List type="number">
                  <List.Item>
                    In the theme editor, click the <strong>Header</strong>{" "}
                    section in the left rail (usually at the very top).
                  </List.Item>
                  <List.Item>
                    Click <strong>+ Add block</strong> at the bottom of its block
                    list.
                  </List.Item>
                  <List.Item>
                    Pick <strong>Quote Cart link</strong> under the{" "}
                    <strong>Apps</strong> group.
                  </List.Item>
                  <List.Item>
                    Drag it next to your existing cart icon. Tweak the icon and
                    badge colors in the right panel.
                  </List.Item>
                  <List.Item>
                    Click <strong>Save</strong>.
                  </List.Item>
                </List>
                <Banner tone="info" title="If your header doesn't accept the block">
                  <p>
                    A few older themes don't allow app blocks in the header
                    section. In that case, edit the theme code (Themes → ⋯ → Edit
                    code → <code>sections/header.liquid</code>) and paste{" "}
                    <code>{`{% render 'quote-cart-navlink' %}`}</code> next to the
                    cart icon.
                  </p>
                </Banner>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="info">Step 3</Badge>
                  <Text as="h2" variant="headingMd">
                    Configure email
                  </Text>
                  {status.emailConfigured && status.notificationsConfigured ? (
                    <Badge tone="success">Configured</Badge>
                  ) : null}
                </InlineStack>
                <Text as="p" variant="bodyMd">
                  Without this, quotes are still <em>saved</em> but no email is
                  sent — neither the customer confirmation nor your notification.
                </Text>
                <List type="number">
                  <List.Item>
                    Go to <RemixLink to="/app/settings">Settings → Email sending</RemixLink>.
                  </List.Item>
                  <List.Item>
                    Fill in <strong>Sender name</strong>, <strong>Sender email</strong>,
                    <strong> SMTP host / port / user / password</strong>, and{" "}
                    <strong>Notification recipients</strong> (comma-separated).
                  </List.Item>
                  <List.Item>
                    Click <strong>Save email settings</strong>, then{" "}
                    <strong>Send test email</strong> to your own address. If the
                    test arrives, you're done.
                  </List.Item>
                </List>
                <Box>
                  <Text as="h3" variant="headingSm">
                    Common SMTP providers
                  </Text>
                  <Box paddingBlockStart="200">
                    <List type="bullet">
                      <List.Item>
                        <strong>Gmail</strong> — Host: <code>smtp.gmail.com</code>{" "}
                        Port: <code>587</code>. The password must be a Google{" "}
                        <Link
                          url="https://myaccount.google.com/apppasswords"
                          target="_blank"
                        >
                          App Password
                        </Link>
                        , not your normal Gmail password (requires 2-Step
                        Verification turned on).
                      </List.Item>
                      <List.Item>
                        <strong>Resend</strong> — Host:{" "}
                        <code>smtp.resend.com</code> Port: <code>465</code> User:{" "}
                        <code>resend</code> Password: API key. Free 100/day.
                      </List.Item>
                      <List.Item>
                        <strong>SendGrid</strong> — Host:{" "}
                        <code>smtp.sendgrid.net</code> Port: <code>587</code> User:{" "}
                        <code>apikey</code> Password: API key.
                      </List.Item>
                      <List.Item>
                        <strong>Brevo / Mailjet / Postmark / Mailgun</strong> —
                        same idea, find the SMTP credentials in their dashboard.
                      </List.Item>
                    </List>
                  </Box>
                </Box>
                <InlineStack gap="200">
                  <Button url="/app/settings" variant="primary">
                    Open Settings → Email
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="info">Step 4</Badge>
                  <Text as="h2" variant="headingMd">
                    Customize the email templates (optional)
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodyMd">
                  Templates ship with sensible defaults in English and Bulgarian.
                  Edit them in <RemixLink to="/app/settings">Settings → Email templates</RemixLink>.
                </Text>
                <List type="bullet">
                  <List.Item>
                    Click any of the variable chips (<code>{`{{customer_name}}`}</code>,{" "}
                    <code>{`{{items_table}}`}</code>, etc.) to insert it at the end
                    of the body.
                  </List.Item>
                  <List.Item>
                    The right pane shows a live preview rendered with sample data.
                  </List.Item>
                  <List.Item>
                    Use <strong>Reset to English defaults</strong> /{" "}
                    <strong>Reset to Bulgarian defaults</strong> if you want to
                    start over.
                  </List.Item>
                </List>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="info">Step 5</Badge>
                  <Text as="h2" variant="headingMd">
                    Set up ad tracking (optional)
                  </Text>
                  {status.trackingConfigured ? (
                    <Badge tone="success">Configured</Badge>
                  ) : null}
                </InlineStack>
                <Text as="p" variant="bodyMd">
                  Each quote submission fires a <code>Lead</code> conversion event
                  to Meta (Pixel + CAPI), GA4, and Google Ads — all sharing one{" "}
                  <code>event_id</code> for deduplication. Use these as your
                  conversion goal in your ad campaigns.
                </Text>
                <Text as="h3" variant="headingSm">
                  Where to find each value
                </Text>
                <List type="bullet">
                  <List.Item>
                    <strong>Meta Pixel ID</strong> —{" "}
                    <Link
                      url="https://business.facebook.com/events_manager2"
                      target="_blank"
                    >
                      Events Manager
                    </Link>{" "}
                    → Data sources → your pixel → Settings.
                  </List.Item>
                  <List.Item>
                    <strong>Meta CAPI access token</strong> — same place →
                    Settings → Conversions API → Generate access token.
                  </List.Item>
                  <List.Item>
                    <strong>Meta test event code</strong> — same place → Test
                    events tab → "Test server events" → copy the{" "}
                    <code>TEST...</code> code (so the events show up live in the
                    Test events tab while you verify).
                  </List.Item>
                  <List.Item>
                    <strong>Google Ads Conversion ID + Label</strong> —{" "}
                    <Link
                      url="https://ads.google.com/aw/conversions"
                      target="_blank"
                    >
                      Google Ads
                    </Link>{" "}
                    → Tools → Conversions → your action → Tag setup → "Use Google
                    tag" — both <code>AW-...</code> and the label after the
                    slash.
                  </List.Item>
                  <List.Item>
                    <strong>GA4 Measurement ID</strong> —{" "}
                    <Link url="https://analytics.google.com/" target="_blank">
                      GA4
                    </Link>{" "}
                    → Admin → Data streams → your stream → starts with{" "}
                    <code>G-...</code>.
                  </List.Item>
                  <List.Item>
                    <strong>GA4 API secret</strong> — same place → Measurement
                    Protocol API secrets → Create.
                  </List.Item>
                </List>
                <Banner tone="info" title="Use Lead as your conversion event">
                  <p>
                    In Meta Ads Manager → create campaign → objective{" "}
                    <strong>Leads</strong> → conversion event{" "}
                    <strong>Lead</strong>. Meta will optimize delivery toward
                    people most likely to submit a quote. Verify it works in
                    Events Manager → Test events tab before launching the
                    campaign.
                  </p>
                </Banner>
                <InlineStack gap="200">
                  <Button url="/app/settings" variant="primary">
                    Open Settings → Tracking
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="info">Step 6</Badge>
                  <Text as="h2" variant="headingMd">
                    Translate strings (optional)
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodyMd">
                  Quote Cart ships translated to English and Bulgarian out of the
                  box. To add other languages or edit any string:
                </Text>
                <List type="number">
                  <List.Item>
                    Install Shopify's free{" "}
                    <Link
                      url="https://apps.shopify.com/translate-and-adapt"
                      target="_blank"
                    >
                      Translate &amp; Adapt
                    </Link>{" "}
                    app from the App Store.
                  </List.Item>
                  <List.Item>
                    Open it → pick the target language → in the left rail go to{" "}
                    <strong>Theme content → Apps → Quote Cart</strong>.
                  </List.Item>
                  <List.Item>
                    Translate any string and save. The storefront uses your
                    overrides automatically when a customer browses in that
                    language.
                  </List.Item>
                </List>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Note: the embedded admin (this UI) is in English only. Email
                  templates have separate Bulgarian defaults editable in{" "}
                  <RemixLink to="/app/settings">Settings → Email templates</RemixLink>
                  .
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="info">Step 7</Badge>
                  <Text as="h2" variant="headingMd">
                    Send a test quote and verify
                  </Text>
                  {status.hasQuotes ? (
                    <Badge tone="success">Verified</Badge>
                  ) : null}
                </InlineStack>
                <List type="number">
                  <List.Item>
                    On the storefront, open any product page and click{" "}
                    <strong>Add to Quote</strong>.
                  </List.Item>
                  <List.Item>
                    Click the basket icon in the header → click{" "}
                    <strong>View Full Quote</strong>.
                  </List.Item>
                  <List.Item>
                    Fill in the contact form with a test email address you can
                    check, hit <strong>Submit Quote Request</strong>.
                  </List.Item>
                  <List.Item>
                    Confirm: the customer email arrives, the merchant
                    notification arrives at every recipient address, and the
                    quote shows up in <RemixLink to="/app/quotes">Quotes</RemixLink>
                    .
                  </List.Item>
                  <List.Item>
                    Open the quote detail to confirm the tracking events
                    section shows ✓ for the platforms you configured. ✗ rows show
                    the exact error so you can fix it.
                  </List.Item>
                </List>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Need a hand?
                </Text>
                <Text as="p" variant="bodyMd">
                  The README in the project root has the same instructions plus
                  troubleshooting for SMTP errors, tracking failures, and theme
                  edge cases. If a tracking event fails, the quote detail page
                  shows the exact error returned by Meta / GA4 / Google.
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
