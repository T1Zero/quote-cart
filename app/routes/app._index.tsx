import { useCallback, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link as RemixLink,
  useFetcher,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  ButtonGroup,
  Button,
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
import {
  getDashboardStats,
  calculateQuoteValue,
  type DashboardRange,
} from "../lib/quote.server";

const VALID_RANGES: DashboardRange[] = ["7d", "14d", "30d", "90d"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const rawRange = (url.searchParams.get("range") || "14d") as DashboardRange;
  const range = VALID_RANGES.includes(rawRange) ? rawRange : "14d";
  const stats = await getDashboardStats(session.shop, range);
  return {
    stats: {
      total: stats.total,
      thisWeek: stats.thisWeek,
      lastWeek: stats.lastWeek,
      pending: stats.pending,
      responded: stats.responded,
      weekOverWeek: stats.weekOverWeek,
      series: stats.series,
      range: stats.range,
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
              <InlineStack align="space-between" blockAlign="center" wrap={false}>
                <Text as="h2" variant="headingMd">
                  Quotes over time
                </Text>
                <RangeSelector current={stats.range} />
              </InlineStack>
              <SparklineChart series={stats.series} range={stats.range} />
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

function RangeSelector({ current }: { current: string }) {
  const [, setSearchParams] = useSearchParams();
  const options: { label: string; value: string }[] = [
    { label: "7 days", value: "7d" },
    { label: "14 days", value: "14d" },
    { label: "30 days", value: "30d" },
    { label: "90 days", value: "90d" },
  ];

  function pick(value: string) {
    const params = new URLSearchParams();
    params.set("range", value);
    setSearchParams(params, { replace: true });
  }

  return (
    <ButtonGroup variant="segmented">
      {options.map((opt) => (
        <Button
          key={opt.value}
          pressed={current === opt.value}
          onClick={() => pick(opt.value)}
          size="slim"
        >
          {opt.label}
        </Button>
      ))}
    </ButtonGroup>
  );
}

function SparklineChart({
  series,
  range,
}: {
  series: { date: string; count: number }[];
  range: string;
}) {
  // Don't render an empty chart if for some reason the series is blank.
  if (series.length === 0) {
    return (
      <Box minHeight="120px" padding="400">
        <Text as="p" variant="bodySm" tone="subdued">
          No data to show.
        </Text>
      </Box>
    );
  }

  const max = Math.max(1, ...series.map((s) => s.count));
  const total = series.reduce((s, p) => s + p.count, 0);

  // Render each bar as a fixed-pixel height SVG so longer ranges don't squash labels.
  // Using non-stretched viewBox (preserveAspectRatio xMidYMid) keeps text legible.
  const barWidth = 24;
  const barGap = 4;
  const chartHeight = 120;
  const labelHeight = 22;
  const totalWidth = series.length * (barWidth + barGap);
  const viewBoxW = totalWidth;
  const viewBoxH = chartHeight + labelHeight;

  return (
    <BlockStack gap="200">
      <InlineStack gap="400" blockAlign="baseline">
        <Text as="span" variant="heading2xl">
          {total}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {total === 1 ? "quote" : "quotes"} in the last{" "}
          {range === "7d" ? "7 days" : range === "30d" ? "30 days" : range === "90d" ? "90 days" : "14 days"}
        </Text>
      </InlineStack>
      <Box>
        <div style={{ overflowX: "auto", paddingBottom: 4 }}>
          <svg
            viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
            width={Math.max(360, totalWidth)}
            height={viewBoxH}
            style={{ maxWidth: "100%", height: "auto" }}
            role="img"
            aria-label={`Daily quote submissions for the last ${series.length} days`}
          >
            {series.map((point, i) => {
              const h = (point.count / max) * chartHeight;
              const x = i * (barWidth + barGap);
              const y = chartHeight - h;
              const isToday = i === series.length - 1;
              const showLabel =
                series.length <= 14 ||
                i === 0 ||
                i === series.length - 1 ||
                i % Math.ceil(series.length / 8) === 0;
              return (
                <g key={point.date}>
                  <title>
                    {point.date}: {point.count} {point.count === 1 ? "quote" : "quotes"}
                  </title>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(2, h)}
                    rx={3}
                    fill={isToday ? "#1f1f1f" : "#9aa1a8"}
                    opacity={point.count === 0 ? 0.25 : 1}
                  />
                  {point.count > 0 && (
                    <text
                      x={x + barWidth / 2}
                      y={y - 4}
                      textAnchor="middle"
                      fontSize={11}
                      fill="#1f1f1f"
                      fontWeight="600"
                    >
                      {point.count}
                    </text>
                  )}
                  {showLabel && (
                    <text
                      x={x + barWidth / 2}
                      y={chartHeight + 14}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#6b7177"
                    >
                      {formatDayLabel(point.date)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </Box>
    </BlockStack>
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
