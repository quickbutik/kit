import { formatMoney, type Product, type ProductVariant } from "@quickbutik/kit"

export type SignShape = "rect" | "circle"

export type Material = {
  key: "aluminium" | "acrylic" | "wood" | "banner" | "plate" | "round"
  label: string
  shape: SignShape
  /** Corner radius in mm for rectangular signs. */
  radiusMm: number
  /** Distance from the edge that print should stay inside, in mm. */
  safeMm: number
  /** Default background colour of a fresh design. */
  background: string
  /** Mounting details drawn on the preview. */
  mounting: "holes" | "standoffs" | "eyelets" | "none"
  tagline: string
  accent: string
}

const MATERIALS: Record<string, Material> = {
  ALU: {
    key: "aluminium",
    label: "Aluminium composite",
    shape: "rect",
    radiusMm: 6,
    safeMm: 10,
    background: "#ffffff",
    mounting: "holes",
    tagline: "Outdoor-proof · 3 mm",
    accent: "#9aa3ad",
  },
  AKR: {
    key: "acrylic",
    label: "Clear acrylic",
    shape: "rect",
    radiusMm: 4,
    safeMm: 15,
    background: "#ffffff",
    mounting: "standoffs",
    tagline: "Glossy depth · 5 mm",
    accent: "#7fd6e8",
  },
  TRA: {
    key: "wood",
    label: "Birch plywood",
    shape: "rect",
    radiusMm: 3,
    safeMm: 8,
    background: "transparent",
    mounting: "none",
    tagline: "Natural grain · 6 mm",
    accent: "#d4a373",
  },
  BAN: {
    key: "banner",
    label: "510 g PVC",
    shape: "rect",
    radiusMm: 0,
    safeMm: 30,
    background: "#ffffff",
    mounting: "eyelets",
    tagline: "Weatherproof · eyelets",
    accent: "#ffd166",
  },
  DOR: {
    key: "plate",
    label: "Brushed aluminium",
    shape: "rect",
    radiusMm: 3,
    safeMm: 4,
    background: "#e9ebee",
    mounting: "none",
    tagline: "Self-adhesive · slim",
    accent: "#c0c6cc",
  },
  RND: {
    key: "round",
    label: "Aluminium composite",
    shape: "circle",
    radiusMm: 0,
    safeMm: 10,
    background: "#ffffff",
    mounting: "holes",
    tagline: "Circular · 3 mm",
    accent: "#ff6b4a",
  },
}

const FALLBACK = MATERIALS.ALU

export function materialFor(product: Product): Material {
  const sku = product.variants[0]?.sku ?? ""
  const prefix = sku.split("-")[0]?.toUpperCase() ?? ""
  return MATERIALS[prefix] ?? FALLBACK
}

export type SignSize = { widthMm: number; heightMm: number; label: string }

/** Reads "30 × 20 cm" or "Ø 50 cm" from a variant's option value. */
export function parseSize(label: string): SignSize | null {
  const rect = /(\d+(?:[.,]\d+)?)\s*[×x]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?/i.exec(label)
  if (rect) {
    const unit = rect[3]?.toLowerCase() === "mm" ? 1 : 10
    return {
      widthMm: parseFloat(rect[1].replace(",", ".")) * unit,
      heightMm: parseFloat(rect[2].replace(",", ".")) * unit,
      label,
    }
  }
  const round = /[Øø⌀]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?/.exec(label)
  if (round) {
    const d = parseFloat(round[1].replace(",", ".")) * (round[2]?.toLowerCase() === "mm" ? 1 : 10)
    return { widthMm: d, heightMm: d, label }
  }
  return null
}

export function variantLabel(variant: ProductVariant): string {
  return variant.options.map((o) => o.name).join(" / ") || variant.sku
}

export function variantSize(variant: ProductVariant): SignSize {
  return parseSize(variantLabel(variant)) ?? { widthMm: 600, heightMm: 400, label: variantLabel(variant) }
}

export function sellableVariants(product: Product): ProductVariant[] {
  return product.variants.filter((v) => !v.hidden)
}

export function fromPrice(product: Product): number | null {
  const prices = sellableVariants(product).flatMap((v) => (v.price.price == null ? [] : [v.price.price]))
  return prices.length ? Math.min(...prices) : product.price
}

export const CURRENCY = "EUR"

export function money(amount: number | null | undefined, currency: string = CURRENCY): string {
  if (amount == null) return ""
  return formatMoney(amount, currency, { locale: "en-IE" })
}
