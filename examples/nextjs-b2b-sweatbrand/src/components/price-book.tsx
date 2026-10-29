"use client"

import { useAsync, useClientCustomerKey, useShopkit } from "@quickbutik/kit/react"
import { createContext, use, type ReactNode } from "react"
import { useSession } from "@/lib/use-session"

export interface VariantPrice {
  /** Ex. moms, minor units. */
  price: number
  /** Ex. moms "before" price, when on sale. */
  comparePrice: number | null
  currency: string
}

interface PriceBook {
  /** `pending`: not known yet (server render and hydration). */
  status: "pending" | "guest" | "loading" | "ready" | "error"
  get(variantId: number): VariantPrice | null
}

const PriceBookContext = createContext<PriceBook>({ status: "pending", get: () => null })

/**
 * The catalog is rendered from a cached, price-less guest read. Prices belong to
 * the logged-in customer (their group), so they're read here, in the browser,
 * with the customer's session, and refetched on every login and logout.
 */
export function PriceBookProvider({ children }: { children: ReactNode }) {
  const client = useShopkit()
  const { isLoggedIn, ready } = useSession()
  const customerKey = useClientCustomerKey(client)

  const { data, loading, error } = useAsync(
    async (signal) => {
      const prices = new Map<number, VariantPrice>()
      let cursor: string | undefined
      do {
        const page = await client.products.list({ limit: 99, cursor, signal })
        for (const product of page.data) {
          for (const variant of product.variants) {
            const amount = variant.price.price ?? product.price
            if (amount == null) continue
            // The shop's prices are entered ex. moms and come back that way
            // (they match the cart's unitPriceExclTax); moms is added at checkout.
            prices.set(variant.id, {
              price: amount,
              comparePrice: variant.price.comparePrice,
              currency: product.currency ?? "SEK",
            })
          }
        }
        cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined
      } while (cursor)
      return prices
    },
    [client, customerKey],
    { enabled: isLoggedIn },
  )

  const status: PriceBook["status"] = !ready
    ? "pending"
    : !isLoggedIn
      ? "guest" : error ? "error" : loading || !data ? "loading" : "ready"
  const book: PriceBook = { status, get: (variantId) => (isLoggedIn ? data?.get(variantId) ?? null : null) }

  return <PriceBookContext value={book}>{children}</PriceBookContext>
}

export function usePriceBook(): PriceBook {
  return use(PriceBookContext)
}
