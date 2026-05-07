import type { Quote, QuoteItem, OrderSettings } from "@prisma/client";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

export type DraftOrderResult =
  | {
      ok: true;
      draftOrderId: string;
      draftOrderName: string;
      draftOrderUrl: string;
      invoiceUrl: string | null;
    }
  | { ok: false; error: string };

export async function getOrInitOrderSettings(shopDomain: string): Promise<OrderSettings> {
  const existing = await prisma.orderSettings.findUnique({ where: { shopDomain } });
  if (existing) return existing;
  return prisma.orderSettings.create({ data: { shopDomain } });
}

/**
 * Build the GraphQL DraftOrderInput for a given quote.
 * Variant IDs are stored as numeric strings; Shopify needs them as GIDs.
 */
function buildDraftOrderInput(
  quote: Quote & { items: QuoteItem[] },
  tag: string,
) {
  return {
    email: quote.customerEmail,
    note: buildNote(quote),
    tags: tag ? [tag] : [],
    customAttributes: [
      { key: "quote_cart_id", value: quote.id },
      { key: "phone", value: quote.customerPhone },
      ...(quote.message ? [{ key: "customer_message", value: quote.message.slice(0, 1024) }] : []),
    ],
    lineItems: quote.items.map((it) => ({
      variantId: `gid://shopify/ProductVariant/${it.variantId}`,
      quantity: it.quantity,
    })),
  };
}

function buildNote(quote: Quote & { items: QuoteItem[] }): string {
  const lines: string[] = [];
  lines.push(`Quote Cart submission #${quote.id}`);
  lines.push(`Submitted: ${quote.createdAt.toISOString()}`);
  lines.push("");
  lines.push(`Name:  ${quote.customerName}`);
  lines.push(`Email: ${quote.customerEmail}`);
  lines.push(`Phone: ${quote.customerPhone}`);
  if (quote.message) {
    lines.push("");
    lines.push("Customer message:");
    lines.push(quote.message);
  }
  return lines.join("\n");
}

const DRAFT_ORDER_CREATE_MUTATION = `#graphql
  mutation draftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DRAFT_ORDER_INVOICE_MUTATION = `#graphql
  mutation draftOrderInvoiceSend($id: ID!) {
    draftOrderInvoiceSend(id: $id) {
      draftOrder { id }
      userErrors { field message }
    }
  }
`;

/**
 * Creates a Shopify draft order from a saved quote.
 * Updates the quote row with the resulting draft order ID/name/URL.
 *
 * Idempotent: if the quote already has a draft order linked, returns it.
 */
export async function createDraftOrderFromQuote(
  shopDomain: string,
  quote: Quote & { items: QuoteItem[] },
): Promise<DraftOrderResult> {
  if (quote.shopifyDraftOrderId && quote.shopifyDraftOrderUrl) {
    return {
      ok: true,
      draftOrderId: quote.shopifyDraftOrderId,
      draftOrderName: quote.shopifyDraftOrderName || "",
      draftOrderUrl: quote.shopifyDraftOrderUrl,
      invoiceUrl: null,
    };
  }

  const settings = await getOrInitOrderSettings(shopDomain);

  let admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];
  try {
    ({ admin } = await unauthenticated.admin(shopDomain));
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not authenticate with Shopify Admin API: ${err.message}`
          : "Could not authenticate with Shopify Admin API",
    };
  }

  try {
    const response = await admin.graphql(DRAFT_ORDER_CREATE_MUTATION, {
      variables: { input: buildDraftOrderInput(quote, settings.draftOrderTag) },
    });
    const json = (await response.json()) as {
      data?: {
        draftOrderCreate?: {
          draftOrder?: { id: string; name: string; invoiceUrl: string | null };
          userErrors: { field: string[] | null; message: string }[];
        };
      };
    };

    const result = json.data?.draftOrderCreate;
    if (!result) {
      return { ok: false, error: "Empty draftOrderCreate response from Shopify." };
    }
    if (result.userErrors && result.userErrors.length > 0) {
      const msg = result.userErrors
        .map((e) => `${e.field?.join(".") || "input"}: ${e.message}`)
        .join("; ");
      return { ok: false, error: `Shopify rejected the draft order — ${msg}` };
    }
    if (!result.draftOrder) {
      return { ok: false, error: "Shopify did not return a draft order." };
    }

    const numericId = result.draftOrder.id.split("/").pop() || "";
    const adminUrl = `https://${shopDomain}/admin/draft_orders/${numericId}`;

    // Persist the link on the Quote row.
    await prisma.quote.update({
      where: { id: quote.id },
      data: {
        shopifyDraftOrderId: result.draftOrder.id,
        shopifyDraftOrderName: result.draftOrder.name,
        shopifyDraftOrderUrl: adminUrl,
      },
    });

    // Optionally send the invoice email (Shopify-generated payment link).
    if (settings.autoSendInvoice) {
      try {
        await admin.graphql(DRAFT_ORDER_INVOICE_MUTATION, {
          variables: { id: result.draftOrder.id },
        });
      } catch (invoiceErr) {
        // Don't fail the whole operation if the invoice send fails.
        // eslint-disable-next-line no-console
        console.warn("[QuoteCart] draftOrderInvoiceSend failed", invoiceErr);
      }
    }

    return {
      ok: true,
      draftOrderId: result.draftOrder.id,
      draftOrderName: result.draftOrder.name,
      draftOrderUrl: adminUrl,
      invoiceUrl: result.draftOrder.invoiceUrl,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
