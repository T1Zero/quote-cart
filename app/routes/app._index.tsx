import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link as RemixLink, useLoaderData } from "@remix-run/react";
import {
  BlockStack,
  Card,
  EmptyState,
  IndexTable,
  InlineGrid,
  Layout,
  Page,
  Text,
  useBreakpoints,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getDashboardStats, calculateQuoteValue } from "../lib/quote.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const stats = await getDashboardStats(session.shop);
  return {
    stats: {
      total: stats.total,
      thisWeek: stats.thisWeek,
      pending: stats.pending,
    },
    recent: stats.recent.map((q) => ({
      id: q.id,
      customerName: q.customerName,
      customerEmail: q.customerEmail,
      itemCount: q.items.reduce((s, i) => s + i.quantity, 0),
      value: calculateQuoteValue(q.items),
      status: q.status,
      createdAt: q.createdAt.toISOString(),
    })),
  };
};

export default function Dashboard() {
  const { stats, recent } = useLoaderData<typeof loader>();
  const { mdUp } = useBreakpoints();

  const rowMarkup = recent.map((q, idx) => (
    <IndexTable.Row id={q.id} key={q.id} position={idx}>
      <IndexTable.Cell>
        <RemixLink to={`/app/quotes/${q.id}`}>
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {q.customerName}
          </Text>
        </RemixLink>
      </IndexTable.Cell>
      <IndexTable.Cell>{q.customerEmail}</IndexTable.Cell>
      <IndexTable.Cell>{q.itemCount}</IndexTable.Cell>
      <IndexTable.Cell>{q.value.toFixed(2)}</IndexTable.Cell>
      <IndexTable.Cell>
        <StatusBadge status={q.status} />
      </IndexTable.Cell>
      <IndexTable.Cell>{formatDate(q.createdAt)}</IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page title="Dashboard">
      <Layout>
        <Layout.Section>
          <InlineGrid columns={mdUp ? 3 : 1} gap="400">
            <StatCard label="Total quotes" value={stats.total} />
            <StatCard label="This week" value={stats.thisWeek} />
            <StatCard
              label="Pending response"
              value={stats.pending}
              tone={stats.pending > 0 ? "critical" : "success"}
            />
          </InlineGrid>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            <BlockStack>
              <div style={{ padding: "16px 16px 0 16px" }}>
                <Text as="h2" variant="headingMd">
                  Recent quotes
                </Text>
              </div>
              {recent.length === 0 ? (
                <EmptyState
                  heading="No quotes yet"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    Quotes will appear here as customers submit them through
                    your storefront.
                  </p>
                </EmptyState>
              ) : (
                <IndexTable
                  resourceName={{ singular: "quote", plural: "quotes" }}
                  itemCount={recent.length}
                  selectable={false}
                  headings={[
                    { title: "Customer" },
                    { title: "Email" },
                    { title: "Items" },
                    { title: "Value" },
                    { title: "Status" },
                    { title: "Submitted" },
                  ]}
                >
                  {rowMarkup}
                </IndexTable>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "critical";
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="heading2xl" tone={tone}>
          {String(value)}
        </Text>
      </BlockStack>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "responded") return <Badge tone="success">Responded</Badge>;
  if (status === "closed") return <Badge>Closed</Badge>;
  return <Badge tone="attention">New</Badge>;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
