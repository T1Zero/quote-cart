import { useState, useCallback, useEffect, useRef } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Link as RemixLink,
  useLoaderData,
  useSearchParams,
  useNavigate,
} from "@remix-run/react";
import {
  Badge,
  Card,
  ChoiceList,
  EmptyState,
  IndexFilters,
  IndexTable,
  Page,
  Text,
  useSetIndexFiltersMode,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
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

export default function QuotesIndex() {
  const { quotes, status, search } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [queryValue, setQueryValue] = useState(search);
  const [statusFilter, setStatusFilter] = useState<string[]>(
    status === "all" ? [] : [status],
  );
  const { mode, setMode } = useSetIndexFiltersMode();

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
          loading={false}
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
