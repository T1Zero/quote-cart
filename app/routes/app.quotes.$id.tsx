import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link as RemixLink, useFetcher, useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  IndexTable,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
  Thumbnail,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getQuoteById, calculateQuoteValue } from "../lib/quote.server";
import { createDraftOrderFromQuote } from "../lib/draftOrder.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const id = params.id;
  if (!id) throw redirect("/app/quotes");

  const quote = await getQuoteById(session.shop, id);
  if (!quote) throw redirect("/app/quotes");

  return {
    quote: {
      id: quote.id,
      customerName: quote.customerName,
      customerEmail: quote.customerEmail,
      customerPhone: quote.customerPhone,
      message: quote.message,
      customerType: quote.customerType,
      vatNumber: quote.vatNumber,
      status: quote.status,
      internalNotes: quote.internalNotes,
      createdAt: quote.createdAt.toISOString(),
      respondedAt: quote.respondedAt?.toISOString() || null,
      value: calculateQuoteValue(quote.items),
      shopifyDraftOrderId: quote.shopifyDraftOrderId,
      shopifyDraftOrderName: quote.shopifyDraftOrderName,
      shopifyDraftOrderUrl: quote.shopifyDraftOrderUrl,
      items: quote.items.map((i) => ({
        id: i.id,
        productTitle: i.productTitle,
        variantTitle: i.variantTitle,
        image: i.image,
        price: parseFloat(i.price) || 0,
        quantity: i.quantity,
      })),
      events: quote.trackingEvents.map((e) => ({
        id: e.id,
        platform: e.platform,
        status: e.status,
        errorMessage: e.errorMessage,
        eventId: e.eventId,
        createdAt: e.createdAt.toISOString(),
      })),
      customFields: quote.customFieldValues.map((cf) => ({
        id: cf.id,
        label: cf.fieldLabel,
        value: cf.fieldValue,
      })),
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const id = params.id;
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  // Make sure this quote belongs to the calling shop before mutating.
  const quote = await prisma.quote.findFirst({
    where: { id, shopDomain: session.shop },
  });
  if (!quote) return json({ ok: false, error: "Not found" }, { status: 404 });

  if (intent === "status") {
    const status = String(formData.get("status") || "new");
    await prisma.quote.update({
      where: { id },
      data: {
        status,
        respondedAt: status === "responded" ? new Date() : quote.respondedAt,
      },
    });
    return json({ ok: true });
  }
  if (intent === "notes") {
    const notes = String(formData.get("internalNotes") || "");
    await prisma.quote.update({ where: { id }, data: { internalNotes: notes } });
    return json({ ok: true });
  }
  if (intent === "mark_responded") {
    await prisma.quote.update({
      where: { id },
      data: { status: "responded", respondedAt: new Date() },
    });
    return json({ ok: true });
  }
  if (intent === "create_draft_order") {
    const fullQuote = await prisma.quote.findFirst({
      where: { id, shopDomain: session.shop },
      include: { items: true },
    });
    if (!fullQuote) return json({ ok: false, error: "Not found" }, { status: 404 });
    const result = await createDraftOrderFromQuote(session.shop, fullQuote);
    if (!result.ok) {
      return json({ ok: false, error: result.error });
    }
    return json({
      ok: true,
      draftOrderName: result.draftOrderName,
      draftOrderUrl: result.draftOrderUrl,
    });
  }
  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

export default function QuoteDetail() {
  const { quote } = useLoaderData<typeof loader>();
  const statusFetcher = useFetcher();
  const notesFetcher = useFetcher();
  const respondFetcher = useFetcher();
  const draftFetcher = useFetcher<{
    ok: boolean;
    error?: string;
    draftOrderName?: string;
    draftOrderUrl?: string;
  }>();
  const [notes, setNotes] = useState(quote.internalNotes);
  const [status, setStatus] = useState(quote.status);

  const draftOrderName =
    (draftFetcher.data?.ok && draftFetcher.data.draftOrderName) ||
    quote.shopifyDraftOrderName ||
    "";
  const draftOrderUrl =
    (draftFetcher.data?.ok && draftFetcher.data.draftOrderUrl) ||
    quote.shopifyDraftOrderUrl ||
    "";
  const draftError =
    draftFetcher.data && !draftFetcher.data.ok ? draftFetcher.data.error : "";

  const lineRows = quote.items.map((it, idx) => (
    <IndexTable.Row id={it.id} key={it.id} position={idx}>
      <IndexTable.Cell>
        <InlineStack gap="300" blockAlign="center">
          <Thumbnail
            source={it.image || "https://cdn.shopify.com/s/images/admin/no-image-compact.gif"}
            alt={it.productTitle}
            size="small"
          />
          <BlockStack gap="050">
            <Text as="span" fontWeight="semibold" variant="bodyMd">
              {it.productTitle}
            </Text>
            {it.variantTitle ? (
              <Text as="span" tone="subdued" variant="bodySm">
                {it.variantTitle}
              </Text>
            ) : null}
          </BlockStack>
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>{it.price.toFixed(2)}</IndexTable.Cell>
      <IndexTable.Cell>{it.quantity}</IndexTable.Cell>
      <IndexTable.Cell>{(it.price * it.quantity).toFixed(2)}</IndexTable.Cell>
    </IndexTable.Row>
  ));

  const mailto = `mailto:${quote.customerEmail}?subject=${encodeURIComponent(`Re: Quote ${quote.id}`)}`;

  return (
    <Page
      title={`Quote from ${quote.customerName}`}
      backAction={{ content: "Quotes", url: "/app/quotes" }}
      titleMetadata={<StatusBadge status={status} />}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Items
                </Text>
                <IndexTable
                  resourceName={{ singular: "item", plural: "items" }}
                  itemCount={quote.items.length}
                  selectable={false}
                  headings={[
                    { title: "Product" },
                    { title: "Unit price" },
                    { title: "Qty" },
                    { title: "Line total" },
                  ]}
                >
                  {lineRows}
                </IndexTable>
                <Divider />
                <InlineStack align="end">
                  <Box minWidth="240px">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        Subtotal
                      </Text>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {quote.value.toFixed(2)}
                      </Text>
                    </InlineStack>
                  </Box>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Customer message
                </Text>
                <Text as="p" variant="bodyMd">
                  {quote.message ? quote.message : <em>(no message)</em>}
                </Text>
              </BlockStack>
            </Card>

            {quote.customFields.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Custom fields
                  </Text>
                  <BlockStack gap="200">
                    {quote.customFields.map((cf) => (
                      <BlockStack key={cf.id} gap="050">
                        <Text as="span" variant="bodySm" tone="subdued">
                          {cf.label}
                        </Text>
                        <Text as="p" variant="bodyMd">
                          {cf.value ? cf.value : <em>(blank)</em>}
                        </Text>
                      </BlockStack>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            )}

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Tracking events
                </Text>
                {quote.events.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    No server-side conversion events fired for this quote. This usually means tracking
                    is disabled or the merchant credentials are not yet configured.
                  </Text>
                ) : (
                  <BlockStack gap="200">
                    {quote.events.map((e) => (
                      <InlineStack key={e.id} gap="300" align="start" blockAlign="start" wrap={false}>
                        <Box minWidth="32px">
                          {e.status === "success" ? (
                            <span aria-label="Success" style={{ color: "#1f8f3a", fontWeight: 700 }}>✓</span>
                          ) : (
                            <span aria-label="Failed" style={{ color: "#d72c0d", fontWeight: 700 }}>✗</span>
                          )}
                        </Box>
                        <BlockStack gap="050">
                          <Text as="span" fontWeight="semibold" variant="bodyMd">
                            {platformLabel(e.platform)}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {e.status === "success"
                              ? `eventID ${e.eventId}`
                              : e.errorMessage || "Unknown error"}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Customer
                </Text>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {quote.customerName}
                  </Text>
                  <Text as="p" variant="bodySm">
                    <a href={mailto}>{quote.customerEmail}</a>
                  </Text>
                  <Text as="p" variant="bodySm">
                    <a href={`tel:${quote.customerPhone}`}>{quote.customerPhone}</a>
                  </Text>
                  {quote.customerType ? (
                    <Text as="p" variant="bodySm">
                      <strong>
                        {quote.customerType === "company" ? "Company" : "Individual"}
                      </strong>
                      {quote.customerType === "company" && quote.vatNumber
                        ? ` · VAT: ${quote.vatNumber}`
                        : ""}
                    </Text>
                  ) : null}
                </BlockStack>
                <InlineStack gap="200">
                  <Button url={mailto} variant="primary">
                    Email customer
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Submission
                </Text>
                <Text as="p" variant="bodySm">
                  <strong>Submitted:</strong> {formatDate(quote.createdAt)}
                </Text>
                {quote.respondedAt ? (
                  <Text as="p" variant="bodySm">
                    <strong>Responded:</strong> {formatDate(quote.respondedAt)}
                  </Text>
                ) : null}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Shopify draft order
                </Text>
                {draftOrderUrl ? (
                  <BlockStack gap="200">
                    <Banner tone="success">
                      Linked to draft order <strong>{draftOrderName}</strong>.
                    </Banner>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Adjust prices, send the invoice, or mark as paid in Shopify.
                      Once paid, it appears in <strong>Orders</strong> with all standard
                      fulfillment tools.
                    </Text>
                    <InlineStack gap="200">
                      <Button url={draftOrderUrl} target="_blank" variant="primary">
                        Open in Shopify
                      </Button>
                    </InlineStack>
                  </BlockStack>
                ) : (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      Create a draft order in Shopify to invoice this customer
                      and (once paid) turn it into a real Order.
                    </Text>
                    {draftError ? (
                      <Banner tone="critical">{draftError}</Banner>
                    ) : null}
                    <draftFetcher.Form method="post">
                      <input type="hidden" name="intent" value="create_draft_order" />
                      <Button
                        submit
                        variant="primary"
                        loading={draftFetcher.state !== "idle"}
                      >
                        Create draft order in Shopify
                      </Button>
                    </draftFetcher.Form>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Tip: enable auto-create in <strong>Settings → Shopify orders</strong>
                      to skip this step on every submission.
                    </Text>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Status
                </Text>
                <statusFetcher.Form method="post">
                  <input type="hidden" name="intent" value="status" />
                  <BlockStack gap="200">
                    <Select
                      label="Status"
                      labelHidden
                      name="status"
                      options={[
                        { label: "New", value: "new" },
                        { label: "Responded", value: "responded" },
                        { label: "Closed", value: "closed" },
                      ]}
                      value={status}
                      onChange={(v) => {
                        setStatus(v);
                        const fd = new FormData();
                        fd.set("intent", "status");
                        fd.set("status", v);
                        statusFetcher.submit(fd, { method: "post" });
                      }}
                    />
                  </BlockStack>
                </statusFetcher.Form>
                {status !== "responded" && (
                  <respondFetcher.Form method="post">
                    <input type="hidden" name="intent" value="mark_responded" />
                    <Button
                      submit
                      onClick={() => setStatus("responded")}
                      loading={respondFetcher.state !== "idle"}
                    >
                      Mark as responded
                    </Button>
                  </respondFetcher.Form>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Internal notes
                </Text>
                {notesFetcher.data && (notesFetcher.data as { ok?: boolean }).ok ? (
                  <Banner tone="success">Notes saved.</Banner>
                ) : null}
                <TextField
                  label="Internal notes"
                  labelHidden
                  multiline={6}
                  name="internalNotes"
                  value={notes}
                  onChange={setNotes}
                  onBlur={() => {
                    if (notes !== quote.internalNotes) {
                      const fd = new FormData();
                      fd.set("intent", "notes");
                      fd.set("internalNotes", notes);
                      notesFetcher.submit(fd, { method: "post" });
                    }
                  }}
                  autoComplete="off"
                  helpText="Saved automatically when you click away."
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Quote ID
                </Text>
                <Text as="p" variant="bodyMd">
                  <code>{quote.id}</code>
                </Text>
                <RemixLink to="/app/quotes">← Back to all quotes</RemixLink>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "responded") return <Badge tone="success">Responded</Badge>;
  if (status === "closed") return <Badge>Closed</Badge>;
  return <Badge tone="attention">New</Badge>;
}

function platformLabel(platform: string): string {
  if (platform === "meta_capi") return "Meta Lead (Conversions API)";
  if (platform === "ga4") return "GA4 generate_lead";
  if (platform === "google_ads") return "Google Ads conversion";
  return platform;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}
