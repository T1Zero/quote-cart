import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { parseOverrides } from "../lib/storefront-strings";

/**
 * App Proxy: GET /apps/quote/strings
 *
 * Returns a small JavaScript file that merges the merchant's translation
 * overrides into `window.QUOTE_CART_STRINGS` BEFORE the main quote-cart.js
 * runs. Each block loads this script (with `defer`) right before main JS,
 * so override order is:
 *
 *   1. Inline <script>: defaults from Liquid `{{ 'key' | t }}`
 *   2. <script src="/apps/quote/strings" defer>: merchant overrides
 *   3. <script src="quote-cart.js" defer>: reads final QUOTE_CART_STRINGS
 *
 * The query param `?lang=` picks which language's overrides to apply
 * (defaults to "en"). The block sets it from `request.locale.iso_code`.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const shopDomain = session?.shop || "";
  const url = new URL(request.url);
  const lang = (url.searchParams.get("lang") || "en").toLowerCase().slice(0, 2);

  let overrides: Record<string, string> = {};
  if (shopDomain) {
    const t = await prisma.translations.findUnique({ where: { shopDomain } });
    if (t) {
      const raw = lang === "bg" ? t.overridesBg : t.overridesEn;
      const parsed = parseOverrides(raw);
      // Drop empty values so blanks fall through to the locale-file defaults.
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && v.trim()) overrides[k] = v;
      }
    }
  }

  const js =
    Object.keys(overrides).length === 0
      ? "/* no translation overrides */"
      : `(function(){var o=${JSON.stringify(
          overrides,
        )};window.QUOTE_CART_STRINGS=Object.assign({},window.QUOTE_CART_STRINGS||{},o);})();`;

  return new Response(js, {
    status: 200,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "private, max-age=60",
    },
  });
};
