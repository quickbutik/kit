"use client"

import type { Cart, Product, ProductVariant } from "@quickbutik/kit"
import { ProductImage, useCart, useShopkitContext } from "@quickbutik/kit/react"
import { useForm } from "@tanstack/react-form"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { errorMessage } from "@/lib/errors"
import { availableStock, buildMatrix, styleNumber } from "@/lib/matrix"
import { money } from "@/lib/money"
import { useSession } from "@/lib/use-session"
import { usePriceBook } from "./price-book"
import { Skeleton } from "./skeleton"

type QtyValues = { qty: Record<string, string> }

/** How long a cell waits after the last keystroke before it updates the cart. */
const SYNC_DEBOUNCE_MS = 600

function parseQty(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function validateQty(variant: ProductVariant, raw: string): string | undefined {
  if (raw.trim() === "") return undefined
  if (!/^\d+$/.test(raw.trim())) return "Whole numbers only"
  const qty = Number(raw)
  if (qty === 0) return undefined
  const stock = availableStock(variant)
  if (stock !== null && qty > stock) return `Only ${stock} available`
  if (variant.minPurchaseQty && qty < variant.minPurchaseQty) return `Min. ${variant.minPurchaseQty}`
  if (variant.maxPurchaseQty && qty > variant.maxPurchaseQty) return `Max. ${variant.maxPurchaseQty}`
  return undefined
}

function cartLine(cart: Cart | null, productId: number, variantId: string) {
  return cart?.items.find((item) => item.productId === productId && String(item.variantId) === variantId) ?? null
}

export function ProductSheet({ product, index, detailed = false }: { product: Product; index: number; detailed?: boolean }) {
  const matrix = buildMatrix(product)
  const prices = usePriceBook()
  const { isLoggedIn, ready } = useSession()
  const { cartStore } = useShopkitContext()
  const { cart, status: cartStatus } = useCart()
  const [saving, setSaving] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const productId = Number(product.id.replace(/^prod_/, ""))
  const variantsById = new Map(product.variants.map((v) => [String(v.id), v]))
  const canOrder = isLoggedIn
  // Until we know who's looking and what's in their order, cells and totals are placeholders.
  const gridLoading = !ready || (isLoggedIn && (cartStatus === "idle" || cartStatus === "loading"))

  // Cells with local edits that haven't reached the cart yet; the cart must not overwrite them.
  const editing = useRef(new Set<string>())
  // One chain of cart writes per cell, so two quick edits can't race into duplicate lines.
  const queue = useRef(new Map<string, Promise<void>>())

  const form = useForm({
    defaultValues: { qty: {} } as QtyValues,
    // Enter in any cell: push every cell's value to the cart now.
    onSubmit: () => {
      for (const variantId of variantsById.keys()) sync(variantId)
    },
  })

  /** Make the cart line for one cell match what the cell says. Safe to call repeatedly. */
  function sync(variantId: string) {
    const run = async () => {
      const variant = variantsById.get(variantId)
      const raw = form.getFieldValue(`qty.${variantId}`) ?? ""
      if (!variant || validateQty(variant, raw)) return
      const want = parseQty(raw)
      const line = cartLine(cartStore.getSnapshot().cart, productId, variantId)
      if (want === (line?.quantity ?? 0)) return

      setError(null)
      setSaving((n) => n + 1)
      const result = line
        ? await cartStore.updateItem(line.id, want)
        : await cartStore.add({ productId: product.id, variantId: variant.id, quantity: want })
      setSaving((n) => n - 1)
      if (!result) setError(errorMessage(cartStore.getSnapshot().error, "Couldn't update your order. Try again."))
    }

    const next: Promise<void> = (queue.current.get(variantId) ?? Promise.resolve()).then(run).finally(() => {
      if (queue.current.get(variantId) !== next) return
      queue.current.delete(variantId)
      // Hand the cell back to the cart unless it was edited again meanwhile.
      const raw = form.getFieldValue(`qty.${variantId}`) ?? ""
      const line = cartLine(cartStore.getSnapshot().cart, productId, variantId)
      if (parseQty(raw) === (line?.quantity ?? 0)) {
        editing.current.delete(variantId)
        form.setFieldValue(`qty.${variantId}`, line ? String(line.quantity) : "", { dontUpdateMeta: true })
      }
    })
    queue.current.set(variantId, next)
  }

  // Pre-fill every cell with what's already in the cart, and follow changes made
  // elsewhere (the order sheet, another tab, logging in or out).
  useEffect(() => {
    if (cartStatus !== "ready" && cartStatus !== "error") return
    for (const variant of product.variants) {
      const variantId = String(variant.id)
      if (editing.current.has(variantId)) continue
      const line = cartLine(cart, productId, variantId)
      const display = line ? String(line.quantity) : ""
      if ((form.getFieldValue(`qty.${variantId}`) ?? "") !== display) {
        form.setFieldValue(`qty.${variantId}`, display, { dontUpdateMeta: true })
      }
    }
  }, [cart, cartStatus, form, product.variants, productId])

  function setCell(variantId: string, value: string) {
    editing.current.add(variantId)
    form.setFieldValue(`qty.${variantId}`, value)
    void form.validateField(`qty.${variantId}`, "change")
  }

  const variantPrices = product.variants.map((v) => prices.get(v.id)).filter((p) => p !== null)
  const min = Math.min(...variantPrices.map((p) => p.price))
  const max = Math.max(...variantPrices.map((p) => p.price))
  const currency = variantPrices[0]?.currency ?? "SEK"

  const description = product.description ?? ""

  return (
    <article className={`sheet${detailed ? " sheet--detailed" : ""}`} id={product.slug ?? product.id}>
      <div className="sheet__plate">
        <span className="sheet__plate-no">{String(index + 1).padStart(2, "0")}</span>
        <Link href={`/products/${product.slug}`} className="sheet__image" tabIndex={-1} aria-hidden={!detailed}>
          <ProductImage
            product={product}
            width={detailed ? 560 : 300}
            height={detailed ? 700 : 375}
            transform={{ fit: "crop" }}
            fallback={<span className="sheet__noimage">No image</span>}
            priority={index < 2}
          />
        </Link>
        {detailed && product.images.length > 1 && (
          <div className="sheet__thumbs">
            {product.images.slice(1).map((image) => (
              <ProductImage key={image.id} image={image} product={product} width={132} height={165} transform={{ fit: "crop" }} />
            ))}
          </div>
        )}
      </div>

      <div className="sheet__body">
        <header className="sheet__head">
          <p className="sheet__style">Style {styleNumber(product)}</p>
          <h2 className="sheet__name">
            {detailed ? product.name : <Link href={`/products/${product.slug}`}>{product.name}</Link>}
          </h2>
          <p className="sheet__price">
            {prices.status === "pending" || prices.status === "loading" ? (
              <Skeleton width={170} height={26} />
            ) : prices.status === "guest" ? (
              <Link href="/login" className="sheet__locked">
                Sign in for wholesale prices
              </Link>
            ) : variantPrices.length === 0 ? (
              <span className="muted">Price on request</span>
            ) : (
              <>
                <span className="sheet__price-amount">
                  {min === max ? money(min, currency) : `${money(min, currency)} – ${money(max, currency)}`}
                </span>
                <span className="sheet__price-unit">/ unit ex. moms</span>
              </>
            )}
          </p>
        </header>

        {description && (
          <div
            className={`sheet__desc${detailed ? "" : " sheet__desc--clamp"}`}
            // Merchant-authored HTML from the shop admin.
            dangerouslySetInnerHTML={{ __html: description }}
          />
        )}

        <form
          className="grid-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <fieldset disabled={!canOrder} className="grid-form__fieldset">
            <legend className="sr-only">Quantities for {product.name}</legend>
            <div className="qty-grid-scroll">
              <table className={`qty-grid${gridLoading ? " qty-grid--loading" : ""}`} aria-busy={gridLoading}>
                <thead>
                  <tr>
                    <th scope="col" className="qty-grid__corner">
                      {matrix.rows.name}
                    </th>
                    {matrix.cols.values.map((col) => (
                      <th scope="col" key={String(col.id)}>
                        {col.name || matrix.cols.name}
                      </th>
                    ))}
                    <th scope="col" className="qty-grid__total">
                      Units
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.values.map((row) => {
                    const rowVariants = matrix.cols.values.map((col) => matrix.cell(row.id, col.id))
                    return (
                      <tr key={String(row.id)}>
                        <th scope="row">
                          <span className="qty-grid__rowname">{row.name || "Each"}</span>
                          {/* Always rendered, so the row is the same height signed in or out. */}
                          <button
                            type="button"
                            className={`qty-grid__run${canOrder ? "" : " qty-grid__run--off"}`}
                            aria-hidden={!canOrder}
                            tabIndex={canOrder ? undefined : -1}
                            title="Add one of every available size in this row"
                            onClick={() => {
                              for (const variant of rowVariants) {
                                if (!variant || variant.hidden || availableStock(variant) === 0) continue
                                const key = String(variant.id)
                                setCell(key, String(parseQty(form.getFieldValue(`qty.${key}`)) + 1))
                                sync(key)
                              }
                            }}
                          >
                            +1 run
                          </button>
                        </th>
                        {rowVariants.map((variant, i) => {
                          const col = matrix.cols.values[i]
                          if (!variant || variant.hidden) {
                            return (
                              <td key={String(col.id)} className="qty-grid__na">
                                —
                              </td>
                            )
                          }
                          const key = String(variant.id)
                          const stock = availableStock(variant)
                          const soldOut = stock === 0
                          const price = prices.get(variant.id)
                          const label = [product.name, row.name, col.name].filter(Boolean).join(" ")
                          return (
                            <td key={String(col.id)}>
                              <form.Field
                                name={`qty.${key}`}
                                validators={{ onChange: ({ value }) => validateQty(variant, value ?? "") }}
                                listeners={{
                                  onChange: () => sync(key),
                                  onChangeDebounceMs: SYNC_DEBOUNCE_MS,
                                  onBlur: () => sync(key),
                                }}
                              >
                                {(field) => {
                                  const fieldError = field.state.meta.errors[0]
                                  const filled = parseQty(field.state.value) > 0
                                  return (
                                    <div
                                      className={`qty-cell${fieldError ? " qty-cell--error" : ""}${filled ? " qty-cell--filled" : ""}`}
                                    >
                                      <input
                                        className="qty-input"
                                        inputMode="numeric"
                                        autoComplete="off"
                                        placeholder={soldOut ? "×" : "0"}
                                        disabled={soldOut}
                                        aria-label={`Quantity, ${label}`}
                                        aria-invalid={Boolean(fieldError)}
                                        name={field.name}
                                        value={field.state.value ?? ""}
                                        // Select on focus so typing replaces the number. A click's
                                        // mouseup would undo the selection, so skip that one mouseup.
                                        onFocus={(e) => {
                                          e.currentTarget.select()
                                          e.currentTarget.dataset.justFocused = "1"
                                        }}
                                        onMouseUp={(e) => {
                                          if (e.currentTarget.dataset.justFocused) e.preventDefault()
                                          delete e.currentTarget.dataset.justFocused
                                        }}
                                        onBlur={field.handleBlur}
                                        onChange={(e) => {
                                          editing.current.add(key)
                                          field.handleChange(e.target.value)
                                        }}
                                      />
                                      <span className="qty-cell__meta">
                                        {fieldError
                                          ? String(fieldError)
                                          : soldOut
                                            ? "Sold out"
                                            : stock !== null
                                              ? `${stock} in stock`
                                              : price && price.price !== min
                                                ? money(price.price, price.currency)
                                                : variant.sku}
                                      </span>
                                    </div>
                                  )
                                }}
                              </form.Field>
                            </td>
                          )
                        })}
                        <td className="qty-grid__total">
                          <form.Subscribe
                            selector={(state) =>
                              rowVariants.reduce((sum, v) => sum + (v ? parseQty(state.values.qty[String(v.id)]) : 0), 0)
                            }
                          >
                            {(units) => <span className={units ? "" : "muted"}>{units}</span>}
                          </form.Subscribe>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </fieldset>

          <footer className="grid-form__foot">
            {gridLoading ? (
              <Skeleton width={260} height={18} />
            ) : canOrder ? (
              <form.Subscribe selector={(state) => state.values.qty}>
                {(values) => {
                  let units = 0
                  let total = 0
                  for (const [variantId, raw] of Object.entries(values)) {
                    const qty = parseQty(raw)
                    if (!qty || !variantsById.has(variantId)) continue
                    units += qty
                    total += qty * (prices.get(Number(variantId))?.price ?? 0)
                  }
                  return (
                    <>
                      <p className="grid-form__sum">
                        <span className="grid-form__sum-label">In your order</span>
                        <span>{units} units</span>
                        {units > 0 && prices.status === "ready" && <span>{money(total, currency)} ex. moms</span>}
                      </p>
                      <p className="grid-form__sync" role="status" aria-live="polite">
                        {error ? (
                          <span className="grid-form__sync--error">{error}</span>
                        ) : saving > 0 ? (
                          <span className="grid-form__sync--saving">Saving…</span>
                        ) : units > 0 ? (
                          <Link href="/order">View order sheet →</Link>
                        ) : (
                          <span className="muted">Type quantities — they&apos;re saved to your order as you go.</span>
                        )}
                      </p>
                    </>
                  )
                }}
              </form.Subscribe>
            ) : (
              <p className="grid-form__locked">
                <Link href="/login">Sign in</Link> or <Link href="/register">open a trade account</Link> to order.
              </p>
            )}
          </footer>
        </form>
      </div>
    </article>
  )
}
