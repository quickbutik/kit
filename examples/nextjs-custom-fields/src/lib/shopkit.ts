import { createShopkitClient, type Product, type Shop, type ShopkitConfig } from "@quickbutik/kit"
import { cacheLife } from "next/cache"

function baseConfig(): ShopkitConfig {
  const publishableKey = process.env.NEXT_PUBLIC_QUICKBUTIK_PUBLISHABLE_KEY
  if (!publishableKey) throw new Error("NEXT_PUBLIC_QUICKBUTIK_PUBLISHABLE_KEY is not set")
  return { publishableKey }
}

/** The browser's config, handed to <ShopkitProvider>. */
export function clientConfig(): ShopkitConfig {
  return baseConfig()
}

/** Catalog reads: no cookies, identical for every visitor, safe to cache. */
function catalog() {
  return createShopkitClient({ ...baseConfig(), storage: "memory" })
}

export async function getProducts(): Promise<Product[]> {
  "use cache"
  cacheLife("minutes")
  const products = await catalog().products.listAll()
  // Oldest first: the order the merchant created the range in.
  const num = (id: string) => Number(id.replace(/\D/g, ""))
  return products.sort((a, b) => num(a.id) - num(b.id))
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  "use cache"
  cacheLife("minutes")
  const products = await getProducts()
  return products.find((p) => p.slug === slug) ?? null
}

export async function getShop(): Promise<Shop | null> {
  "use cache"
  cacheLife("hours")
  return catalog().shop.get().catch(() => null)
}
