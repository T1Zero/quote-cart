import type { Quote, QuoteItem } from "@prisma/client";
import prisma from "../db.server";

export type IncomingQuoteItem = {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle?: string;
  image?: string;
  price?: string | number;
  quantity?: number;
};

export type IncomingQuote = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  message?: string;
  items: IncomingQuoteItem[];
};

export type ValidationError = {
  field: string;
  message: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+0-9\s().-]{6,}$/;

export function validateIncomingQuote(input: IncomingQuote): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!input.customerName || input.customerName.trim().length < 2) {
    errors.push({ field: "customerName", message: "Please enter your name." });
  }
  if (!input.customerEmail || !EMAIL_RE.test(input.customerEmail.trim())) {
    errors.push({ field: "customerEmail", message: "Please enter a valid email address." });
  }
  if (!input.customerPhone || !PHONE_RE.test(input.customerPhone.trim())) {
    errors.push({ field: "customerPhone", message: "Please enter a valid phone number." });
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    errors.push({ field: "items", message: "Your quote is empty. Add at least one product." });
  } else {
    for (const item of input.items) {
      if (!item.variantId || !item.productId || !item.productTitle) {
        errors.push({ field: "items", message: "One or more products are missing required information." });
        break;
      }
      if (!item.quantity || item.quantity < 1) {
        errors.push({ field: "items", message: "Quantity must be at least 1 for each product." });
        break;
      }
    }
  }
  return errors;
}

export async function persistQuote(
  shopDomain: string,
  input: IncomingQuote,
): Promise<Quote & { items: QuoteItem[] }> {
  return prisma.quote.create({
    data: {
      shopDomain,
      customerName: input.customerName.trim(),
      customerEmail: input.customerEmail.trim(),
      customerPhone: input.customerPhone.trim(),
      message: (input.message || "").trim(),
      items: {
        create: input.items.map((it) => ({
          productId: String(it.productId),
          variantId: String(it.variantId),
          productTitle: it.productTitle,
          variantTitle: it.variantTitle || "",
          image: it.image || "",
          price: typeof it.price === "number" ? it.price.toFixed(2) : String(it.price ?? "0"),
          quantity: Math.max(1, Math.floor(it.quantity || 1)),
        })),
      },
    },
    include: { items: true },
  });
}

export function calculateQuoteValue(items: QuoteItem[]): number {
  return items.reduce((sum, item) => {
    const price = parseFloat(item.price) || 0;
    return sum + price * item.quantity;
  }, 0);
}

export async function listQuotes(
  shopDomain: string,
  opts: { status?: string; search?: string; limit?: number } = {},
) {
  const where: Record<string, unknown> = { shopDomain };
  if (opts.status && opts.status !== "all") {
    where.status = opts.status;
  }
  if (opts.search && opts.search.trim()) {
    const q = opts.search.trim();
    where.OR = [
      { customerName: { contains: q } },
      { customerEmail: { contains: q } },
    ];
  }
  return prisma.quote.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 100,
    include: { items: true },
  });
}

export async function getQuoteById(shopDomain: string, id: string) {
  return prisma.quote.findFirst({
    where: { id, shopDomain },
    include: {
      items: true,
      trackingEvents: { orderBy: { createdAt: "asc" } },
      customFieldValues: { orderBy: { id: "asc" } },
    },
  });
}

export async function getDashboardStats(shopDomain: string) {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const [total, thisWeek, pending, recent] = await Promise.all([
    prisma.quote.count({ where: { shopDomain } }),
    prisma.quote.count({ where: { shopDomain, createdAt: { gte: oneWeekAgo } } }),
    prisma.quote.count({ where: { shopDomain, status: "new" } }),
    prisma.quote.findMany({
      where: { shopDomain },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { items: true },
    }),
  ]);
  return { total, thisWeek, pending, recent };
}
