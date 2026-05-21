import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

// Defensive: env vars on production hosts are often pasted without a protocol
// (e.g., "quote-cart.up.railway.app"). Auto-prepend https:// so the Shopify
// SDK doesn't crash the boot with "Invalid appUrl configuration".
function normalizeAppUrl(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// Debug — print env-var sanity info on boot. Lets us confirm what the
// container actually loaded vs. what's in Partners. Remove after the
// signature mismatch is resolved.
const _secret = process.env.SHOPIFY_API_SECRET || "";
const _key = process.env.SHOPIFY_API_KEY || "";
// eslint-disable-next-line no-console
console.log(
  "[QuoteCart boot] api_key first 8:", _key.slice(0, 8),
  "| api_secret length:", _secret.length,
  "| api_secret first 6:", _secret.slice(0, 6),
  "| api_secret last 4:", _secret.slice(-4),
  "| trimmed length:", _secret.trim().length,
);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: normalizeAppUrl(process.env.SHOPIFY_APP_URL),
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
