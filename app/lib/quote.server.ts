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
  customerType?: string;  // "individual" | "company" | ""
  vatNumber?: string;
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
  // Customer type is required so we know whether to expect a VAT number.
  if (
    input.customerType !== "individual" &&
    input.customerType !== "company"
  ) {
    errors.push({
      field: "customerType",
      message: "Please tell us whether you're an individual or a company.",
    });
  }
  // VAT is required only when the customer is a company.
  if (input.customerType === "company" && (!input.vatNumber || input.vatNumber.trim().length < 3)) {
    errors.push({
      field: "vatNumber",
      message: "Please enter your company VAT / tax number.",
    });
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
      customerType:
        input.customerType === "company" || input.customerType === "individual"
          ? input.customerType
          : "",
      vatNumber: input.customerType === "company" ? (input.vatNumber || "").trim() : "",
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

export type DashboardRange = "7d" | "14d" | "30d" | "90d";

export function rangeDays(range: DashboardRange): number {
  if (range === "7d") return 7;
  if (range === "14d") return 14;
  if (range === "30d") return 30;
  if (range === "90d") return 90;
  return 14;
}

export async function getDashboardStats(
  shopDomain: string,
  range: DashboardRange = "14d",
) {
  const now = new Date();
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const days = rangeDays(range);
  const rangeStart = new Date(now);
  rangeStart.setDate(rangeStart.getDate() - (days - 1));
  rangeStart.setHours(0, 0, 0, 0);

  const [total, thisWeek, lastWeek, pending, responded, recent, rangeRaw] = await Promise.all([
    prisma.quote.count({ where: { shopDomain } }),
    prisma.quote.count({ where: { shopDomain, createdAt: { gte: oneWeekAgo } } }),
    prisma.quote.count({
      where: { shopDomain, createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo } },
    }),
    prisma.quote.count({ where: { shopDomain, status: "new" } }),
    prisma.quote.count({ where: { shopDomain, status: "responded" } }),
    prisma.quote.findMany({
      where: { shopDomain },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { items: true },
    }),
    prisma.quote.findMany({
      where: { shopDomain, createdAt: { gte: rangeStart } },
      select: { createdAt: true },
    }),
  ]);

  // Build a series of counts per day for the chosen range.
  const series: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    day.setHours(0, 0, 0, 0);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const count = rangeRaw.filter((q) => q.createdAt >= day && q.createdAt < next).length;
    series.push({ date: day.toISOString().slice(0, 10), count });
  }

  // Week-over-week percentage change. null when last week was zero (no baseline).
  let weekOverWeek: number | null = null;
  if (lastWeek > 0) {
    weekOverWeek = ((thisWeek - lastWeek) / lastWeek) * 100;
  } else if (thisWeek > 0) {
    weekOverWeek = 100;
  } else {
    weekOverWeek = 0;
  }

  return {
    total,
    thisWeek,
    lastWeek,
    pending,
    responded,
    recent,
    series,
    range,
    weekOverWeek,
  };
}
