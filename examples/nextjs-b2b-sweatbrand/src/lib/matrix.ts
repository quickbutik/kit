import type { Product, ProductVariant } from "@quickbutik/kit"

export interface Axis {
  id: number | null
  name: string
  values: { id: number | null; name: string }[]
}

export interface OrderMatrix {
  rows: Axis
  cols: Axis
  cell(rowValueId: number | null, colValueId: number | null): ProductVariant | null
}

/**
 * Lays a product's variants out as a grid: the first option (Color) down the
 * side, the second (Size) across the top. Products with one option get a
 * single row; products without options get a single cell.
 */
export function buildMatrix(product: Product): OrderMatrix {
  const optionTypes = [...(product.options ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

  const axisFor = (index: number): Axis => {
    const type = optionTypes[index]
    if (!type) return { id: null, name: index === 0 ? "" : "Qty", values: [{ id: null, name: "" }] }
    const seen = new Map<number, { id: number; name: string; position: number }>()
    for (const variant of product.variants) {
      for (const value of variant.options) {
        if (value.optionId === type.id && !seen.has(value.id)) {
          seen.set(value.id, { id: value.id, name: value.name ?? "", position: value.position ?? 0 })
        }
      }
    }
    const values = [...seen.values()].sort((a, b) => a.position - b.position)
    return { id: type.id, name: type.name ?? "", values }
  }

  const rows = axisFor(0)
  const cols = axisFor(1)

  const index = new Map<string, ProductVariant>()
  for (const variant of product.variants) {
    const rowValue = rows.id === null ? null : variant.options.find((o) => o.optionId === rows.id)?.id ?? null
    const colValue = cols.id === null ? null : variant.options.find((o) => o.optionId === cols.id)?.id ?? null
    index.set(`${rowValue}:${colValue}`, variant)
  }

  return { rows, cols, cell: (r, c) => index.get(`${r}:${c}`) ?? null }
}

/** `stock: null` means untracked, which is purchasable. */
export function availableStock(variant: ProductVariant): number | null {
  const { stock, allowBackorder } = variant.stock as ProductVariant["stock"] & { allowBackorder?: boolean }
  if (stock === null || allowBackorder) return null
  return Math.max(0, stock)
}

export function styleNumber(product: Product): string {
  const sku = product.variants[0]?.sku ?? ""
  const match = /^([A-Z]+-\d+)/.exec(sku)
  return match ? match[1] : product.id.replace("prod_", "#")
}
