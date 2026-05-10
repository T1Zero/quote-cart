import { useCallback, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link as RemixLink,
  useFetcher,
  useLoaderData,
  useNavigate,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Card,
  EmptyState,
  IndexTable,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text,
  useBreakpoints,
  useIndexResourceState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getDashboardStats, calculateQuoteValue } from "../lib/quote.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const stats = await getDashboardStats(session.shop);
  return {
    stats: {
      total: stats.total,
      thisWeek: stats.thisWeek,
      lastWeek: stats.lastWeek,
      pending: stats.pending,
      responded: stats.responded,
      weekOverWeek: stats.weekOverWeek,
      series: stats.series,
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "delete_quotes") {
    const idsRaw = String(formData.get("ids") || "");
    const ids = idsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      return json({ ok: false, error: "No quotes selected." });
    }
    const result = await prisma.quote.deleteMany({
      where: { id: { in: ids }, shopDomain: session.shop },
    });
    return json({ ok: true, deleted: result.count });
  }

  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

export default function Dashboard() {
  const { stats, recent } = useLoaderData<typeof loader>();
  const { mdUp } = useBreakpoints();
  const navigate = useNavigate();
  const deleteFetcher = useFetcher<{
    ok: boolean;
    deleted?: number;
    error?: string;
  }>();

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(recent.map((q) => ({ ...q, id: q.id })));

  useEffect(() => {
    if (deleteFetcher.data?.ok) clearSelection();
  }, [deleteFetcher.data, clearSelection]);

  const handleBulkDelete = useCallback(() => {
    if (selectedResources.length === 0) return;
    const noun = selectedResources.length === 1 ? "quote" : "quotes";
    if (
      !window.confirm(
        `Delete ${selectedResources.length} ${noun}? This cannot be undone.`,
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.set("intent", "delete_quotes");
    fd.set("ids", selectedResources.join(","));
    deleteFetcher.submit(fd, { method: "post" });
  }, [selectedResources, deleteFetcher]);

  const rowMarkup = recent.map((q, idx) => (
    <IndexTable.Row
      id={q.id}
      key={q.id}
      position={idx}
      selected={selectedResources.includes(q.id)}
      onClick={() => navigate(`/app/quotes/${q.id}`)}
    >
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
        {deleteFetcher.data?.ok && deleteFetcher.data.deleted ? (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => {}}>
              Deleted {deleteFetcher.data.deleted}{" "}
              {deleteFetcher.data.deleted === 1 ? "quote" : "quotes"}.
            </Banner>
          </Layout.Section>
        ) : null}
        {deleteFetcher.data && !deleteFetcher.data.ok && deleteFetcher.data.error ? (
          <Layout.Section>
            <Banner tone="critical">{deleteFetcher.data.error}</Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <InlineGrid columns={mdUp ? 4 : 2} gap="400">
            <StatCard label="Total quotes" value={stats.total} />
            <StatCard
              label="This week"
              value={stats.thisWeek}
              delta={stats.weekOverWeek}
              comparison={`vs ${stats.lastWeek} last week`}
            />
            <StatCard
              label="Pending response"
              value={stats.pending}
              tone={stats.pending > 0 ? "critical" : "success"}
            />
            <StatCard
              label="Responded"
              value={stats.responded}
              tone="success"
            />
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Last 14 days
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  Quotes per day
                </Text>
              </InlineStack>
              <SparklineChart series={stats.series} />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <BlockStack>
              <Box padding="400" paddingBlockEnd="0">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Recent quotes
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Showing {recent.length} of {stats.total}
                  </Text>
                </InlineStack>
              </Box>
              {recent.length === 0 ? (
                <EmptyState
                  heading="No quotes yet"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    Quotes will appear here as customers submit them through
                    your storefront. Add the Add to Quote button block to your
                    product pages from the theme editor to start collecting.
                  </p>
                </EmptyState>
              ) : (
                <IndexTable
                  resourceName={{ singular: "quote", plural: "quotes" }}
                  itemCount={recent.length}
                  selectedItemsCount={
                    allResourcesSelected ? "All" : selectedResources.length
                  }
                  onSelectionChange={handleSelectionChange}
                  promotedBulkActions={[
                    {
                      content: "Delete",
                      onAction: handleBulkDelete,
                    },
                  ]}
                  loading={deleteFetcher.state !== "idle"}
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
  delta,
  comparison,
}: {
  label: string;
  value: number;
  tone?: "success" | "critical";
  delta?: number | null;
  comparison?: string;
}) {
  const showDelta = typeof delta === "number" && !Number.isNaN(delta);
  const deltaTone = showDelta
    ? delta! > 0
      ? "success"
      : delta! < 0
        ? "critical"
        : "subdued"
    : "subdued";
  const deltaArrow = showDelta
    ? delta! > 0
      ? "▲"
      : delta! < 0
        ? "▼"
        : "—"
    : "";

  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <InlineStack gap="200" blockAlign="baseline">
          <Text as="p" variant="heading2xl" tone={tone}>
            {String(value)}
          </Text>
          {showDelta && (
            <Text as="span" variant="bodySm" tone={deltaTone}>
              {deltaArrow} {Math.abs(delta!).toFixed(0)}%
            </Text>
          )}
        </InlineStack>
        {comparison && (
          <Text as="p" variant="bodySm" tone="subdued">
            {comparison}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

function SparklineChart({ series }: { series: { date: string; count: number }[] }) {
  const max = Math.max(1, ...series.map((s) => s.count));
  const width = 100;
  const height = 28;
  const barWidth = width / series.length;
  const padBetween = 1;

  return (
    <Box>
      <svg
        viewBox={`0 0 ${width} ${height + 12}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "auto", maxHeight: 140 }}
        role="img"
        aria-label="Daily quote submissions for the last 14 days"
      >
        {series.map((point, i) => {
          const h = (point.count / max) * height;
          const x = i * barWidth;
          const y = height - h;
          const isToday = i === series.length - 1;
          return (
            <g key={point.date}>
              <title>
                {point.date}: {point.count} {point.count === 1 ? "quote" : "quotes"}
              </title>
              <rect
                x={x + padBetween / 2}
                y={y}
                width={Math.max(0, barWidth - padBetween)}
                height={Math.max(0.6, h)}
                rx={0.4}
                fill={isToday ? "#1f1f1f" : "#9aa1a8"}
                opacity={point.count === 0 ? 0.25 : 1}
              />
              {(i === 0 || i === series.length - 1) && (
                <text
                  x={x + barWidth / 2}
                  y={height + 9}
                  textAnchor="middle"
                  fontSize={3}
                  fill="#6b7177"
                >
                  {formatDayLabel(point.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </Box>
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

function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
