import { createShopkitClient, type Product } from "@quickbutik/kit"
import { cacheLife, cacheTag } from "next/cache"
import { publishableKey } from "./config"

/**
 * The catalog as a guest sees it: names, images, variants and stock, no prices.
 * It is the same for every visitor, so it is safe to cache across requests.
 * Prices are customer-specific and are fetched in the browser (see PriceBook).
 */
function guestClient() {
  return createShopkitClient({ publishableKey: publishableKey(), storage: "memory" })
}

export async function getCatalog(): Promise<Product[]> {
  "use cache"
  cacheLife("minutes")
  cacheTag("catalog")
  return guestClient().products.listAll({ pageSize: 99 })
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const catalog = await getCatalog()
  return catalog.find((product) => product.slug === slug) ?? null
}
