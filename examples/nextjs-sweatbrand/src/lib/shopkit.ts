import {
  createShopkitClient,
  describeCurrency,
  normalizeCurrency,
  type Page,
  type Shop,
  type ShopkitConfig,
} from "@quickbutik/kit";
import { cacheLife } from "next/cache";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { Catalog } from "./catalog";

// The platform also says whether the checkout runs in demo mode.
type ShopResponse = Shop & { demo?: { enabled?: boolean } | null };

/** The storefront's fixed origin, for canonical URLs. Never the Host header. */
export function siteUrl() {
  const url = process.env.NEXT_PUBLIC_SITE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SITE_URL is not set");
  return url.replace(/\/+$/, "");
}

/** The browser's config for <ShopkitProvider>. Only the publishable key. */
export function clientConfig(): ShopkitConfig {
  const publishableKey = process.env.NEXT_PUBLIC_QUICKBUTIK_PUBLISHABLE_KEY;
  if (!publishableKey)
    throw new Error("NEXT_PUBLIC_QUICKBUTIK_PUBLISHABLE_KEY is not set");
  return { publishableKey };
}

async function allPages<T>(read: (cursor?: string) => Promise<Page<T>>) {
  const items: T[] = [];
  let cursor: string | undefined;
  // Bounded, so a misbehaving cursor can never loop forever.
  for (let page = 0; page < 50; page++) {
    const result = await read(cursor);
    items.push(...result.data);
    if (!result.has_more || !result.next_cursor) break;
    cursor = result.next_cursor;
  }
  return items;
}

/**
 * The visible catalog, its categories and the shop, priced in `currency` (null
 * for the shop's own). Reads no cookies, so every visitor browsing in the same
 * currency gets the same snapshot, and the currency is part of the cache key.
 */
export async function getCatalog(currency: string | null): Promise<Catalog> {
  "use cache";
  cacheLife("minutes");
  const shopkit = createShopkitClient({
    ...clientConfig(),
    currency,
    storage: "memory",
  });
  const [shop, accounts, products, categories] = await Promise.all([
    shopkit.shop.get() as Promise<ShopResponse>,
    shopkit.customers.config(),
    allPages((cursor) => shopkit.products.search({ limit: 200, cursor })),
    allPages((cursor) => shopkit.categories.list({ limit: 200, cursor })),
  ]);
  if (!shop.currency) throw new Error("The Quickbutik shop has no currency");
  const productIds = await Promise.all(
    categories.map(async (category) =>
      (
        await allPages((cursor) =>
          shopkit.products.search({
            categoryId: category.id,
            limit: 200,
            cursor,
          }),
        )
      ).map((product) => product.id),
    ),
  );
  const { demo, ...rest } = shop;
  return {
    shop: { ...rest, currency: shop.currency, demo: demo?.enabled ?? false },
    accounts,
    products,
    categories: categories.map((category, index) => ({
      ...category,
      name: category.name ?? category.id,
      slug: category.slug ?? category.id,
      productIds: productIds[index],
    })),
  };
}

/**
 * The currency this visitor browses in: their choice in the kit's
 * `qb_currency` cookie when the shop offers it, else null for the shop's own.
 * Only offered currencies come back, so a tampered cookie can neither fail a
 * request nor add entries to the catalog cache.
 */
export async function requestCurrency() {
  const [jar, { shop }] = await Promise.all([cookies(), getCatalog(null)]);
  let chosen: string | null = null;
  try {
    chosen = normalizeCurrency(jar.get("qb_currency")?.value);
  } catch {
    /* A malformed code reads as no choice, as it does in the kit. */
  }
  const { currency } = describeCurrency(shop, chosen);
  return currency === shop.currency ? null : currency;
}

/**
 * This visitor's cart (never creating one) and cookie consent decision, so the
 * first paint shows the real bag and the banner never flashes.
 */
export async function visitorState() {
  // The kit's retries and rate-limit pacing read Math.random() and Date.now(),
  // which Next refuses while prerendering; this is per request anyway.
  await connection();
  const jar = await cookies();
  const shopkit = createShopkitClient({
    ...clientConfig(),
    cookies: { get: (name) => jar.get(name)?.value ?? null },
  });
  const [cart, consent] = await Promise.all([
    shopkit.cart.current().catch(() => null),
    shopkit.consent.read(),
  ]);
  // Only a hint for the first render: the browser owns and validates the session.
  const signedIn = jar.has("qb_customer_session");
  return { cart, consent, signedIn };
}

/** Free-text search across names, SKUs and option values, in catalog order. */
export async function searchProducts(query: string, currency: string | null) {
  "use cache";
  cacheLife("minutes");
  const shopkit = createShopkitClient({
    ...clientConfig(),
    currency,
    storage: "memory",
  });
  return (await shopkit.products.search({ search: query, limit: 48 })).data;
}
