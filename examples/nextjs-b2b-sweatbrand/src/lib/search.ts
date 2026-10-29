import type { Product } from "@quickbutik/kit"
import { styleNumber } from "./matrix"

/** Lower-case and strip accents, so "hoodie", "HOODIE" and "hóodie" all match. */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

/** Everything a buyer might type to find a style: name, style no., SKUs, colours, sizes, description. */
export function searchText(product: Product): string {
  const parts = [product.name ?? "", styleNumber(product), product.description?.replace(/<[^>]*>/g, " ") ?? ""]
  for (const variant of product.variants) {
    parts.push(variant.sku)
    for (const value of variant.options) parts.push(value.name ?? "")
  }
  return normalize(parts.join(" "))
}

/** Every word of the query must appear somewhere, in any order. */
export function matches(haystack: string, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  return words.every((word) => haystack.includes(word))
}
