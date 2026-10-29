import type { Product, ProductField } from "@quickbutik/kit"

/** Links to a stored design, shared by the browser and the server. */

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "")
}

/** The absolute link stored on the cart line: what the merchant opens from the order. */
export function designPageUrl(id: string): string {
  return `${siteUrl()}/designs/${id}`
}

export function designPreviewPath(id: string): string {
  return `/designs/${id}/preview`
}

export function designPrintPath(id: string): string {
  return `/designs/${id}/print`
}

/** Pulls the design id back out of a cart line's property value. */
export function designIdFromValue(value: string | null | undefined): string | null {
  const match = /\/designs\/([a-f0-9-]{36})/.exec(value ?? "")
  return match ? match[1] : null
}

/** The text "produktfält" each sign carries in the admin to hold the design link. */
export const DESIGN_FIELD_TITLE = "Design link"

/**
 * The design field on a product, matched by title: field ids differ per
 * product and change whenever the merchant saves the product's fields.
 */
export function designField(product: Product): ProductField | null {
  return product.fields?.find((f) => f.title.trim().toLowerCase() === DESIGN_FIELD_TITLE.toLowerCase()) ?? null
}
