import { useState, useCallback, useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link as RemixLink,
  useFetcher,
  useLoaderData,
  useSearchParams,
  useNavigate,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  Card,
  ChoiceList,
  EmptyState,
  IndexFilters,
  IndexTable,
  Page,
  Text,
  useIndexResourceState,
  useSetIndexFiltersMode,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { listQuotes, calculateQuoteValue } from "../lib/quote.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "all";
  const search = url.searchParams.get("q") || "";

  const quotes = await listQuotes(session.shop, { status, search });
  return {
    status,
    search,
    quotes: quotes.map((q) => ({
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
    // Cascade delete the quote (and via FK, items, custom field values, tracking events).
    // Scoped by shopDomain to prevent cross-shop deletion attempts.
    const result = await prisma.quote.deleteMany({
      where: { id: { in: ids }, shopDomain: session.shop },
    });
    return json({ ok: true, deleted: result.count });
  }

  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

export default function QuotesIndex() {
  const { quotes, status, search } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const deleteFetcher = useFetcher<{ ok: boolean; deleted?: number; error?: string }>();

  const [queryValue, setQueryValue] = useState(search);
  const [statusFilter, setStatusFilter] = useState<string[]>(
    status === "all" ? [] : [status],
  );
  const { mode, setMode } = useSetIndexFiltersMode();

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(
    quotes.map((q) => ({ ...q, id: q.id })),
  );

  // Clear selection after a successful delete (the loader will re-run via Remix
  // automatically because we used a fetcher.Form; we just sweep the selection state).
  useEffect(() => {
    if (deleteFetcher.data?.ok) {
      clearSelection();
    }
  }, [deleteFetcher.data, clearSelection]);

  const applyFilters = useCallback(
    (q: string, statuses: string[]) => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (statuses.length === 1) params.set("status", statuses[0]);
      setSearchParams(params, { replace: true });
    },
    [setSearchParams],
  );

  // Debounce query changes — reload data 350ms after the last keystroke.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialQueryRef = useRef(search);
  useEffect(() => {
    if (queryValue === initialQueryRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      applyFilters(queryValue, statusFilter);
      initialQueryRef.current = queryValue;
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [queryValue, statusFilter, applyFilters]);

  const handleStatusChange = useCallback(
    (value: string[]) => {
      setStatusFilter(value);
      applyFilters(queryValue, value);
    },
    [applyFilters, queryValue],
  );

  const handleQueryChange = useCallback((value: string) => {
    setQueryValue(value);
  }, []);

  const handleQueryClear = useCallback(() => {
    setQueryValue("");
    initialQueryRef.current = "";
    applyFilters("", statusFilter);
  }, [applyFilters, statusFilter]);

  const handleClearAll = useCallback(() => {
    setQueryValue("");
    setStatusFilter([]);
    initialQueryRef.current = "";
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

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

  const filters = [
    {
      key: "status",
      label: "Status",
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={[
            { label: "New", value: "new" },
            { label: "Responded", value: "responded" },
            { label: "Closed", value: "closed" },
          ]}
          selected={statusFilter}
          onChange={handleStatusChange}
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters =
    statusFilter.length > 0
      ? [
          {
            key: "status",
            label: `Status: ${statusFilter[0]}`,
            onRemove: () => handleStatusChange([]),
          },
        ]
      : [];

  const rowMarkup = quotes.map((q, idx) => (
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
    <Page title="Quotes" subtitle={`${quotes.length} total`}>
      {deleteFetcher.data?.ok && deleteFetcher.data.deleted ? (
        <Banner tone="success" onDismiss={() => {}}>
          Deleted {deleteFetcher.data.deleted}{" "}
          {deleteFetcher.data.deleted === 1 ? "quote" : "quotes"}.
        </Banner>
      ) : null}
      {deleteFetcher.data && !deleteFetcher.data.ok && deleteFetcher.data.error ? (
        <Banner tone="critical">{deleteFetcher.data.error}</Banner>
      ) : null}
      <Card padding="0">
        <IndexFilters
          mode={mode}
          setMode={setMode}
          queryValue={queryValue}
          queryPlaceholder="Search by name or email"
          onQueryChange={handleQueryChange}
          onQueryClear={handleQueryClear}
          onClearAll={handleClearAll}
          tabs={[]}
          filters={filters}
          appliedFilters={appliedFilters}
          selected={0}
          canCreateNewView={false}
          onSort={() => {}}
          sortOptions={[]}
          sortSelected={[]}
          hideQueryField={false}
          hideFilters={false}
          loading={deleteFetcher.state !== "idle"}
        />
        {quotes.length === 0 ? (
          <EmptyState
            heading="No quotes match"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Try changing the filters or search term.</p>
          </EmptyState>
        ) : (
          <IndexTable
            resourceName={{ singular: "quote", plural: "quotes" }}
            itemCount={quotes.length}
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
      </Card>
    </Page>
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
