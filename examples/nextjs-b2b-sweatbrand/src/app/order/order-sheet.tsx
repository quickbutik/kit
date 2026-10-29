"use client"

import { applyImageTransform, type Cart } from "@quickbutik/kit"
import { useCart, useCheckout, useShopkitContext } from "@quickbutik/kit/react"
import { useForm } from "@tanstack/react-form"
import Link from "next/link"
import { useState } from "react"
import { errorMessage } from "@/lib/errors"
import { money } from "@/lib/money"
import { Skeleton } from "@/components/skeleton"
import { useSession } from "@/lib/use-session"

export function OrderSheet() {
  const { cart, status } = useCart()
  const { isLoggedIn, ready } = useSession()

  if (!ready || status === "idle" || status === "loading") return <OrderSheetSkeleton />

  if (!cart || cart.items.length === 0) {
    return (
      <div className="empty">
        <p>Your order sheet is empty.</p>
        <p>
          <Link href="/">Open the catalogue</Link> and enter quantities per colour and size.
          {!isLoggedIn && (
            <>
              {" "}
              You&apos;ll need to <Link href="/login">sign in</Link> first.
            </>
          )}
        </p>
      </div>
    )
  }

  // Re-key on every server-side change so the quantity fields start from the cart's figures.
  return <OrderLines key={cart.updatedAt + cart.items.map((i) => `${i.id}:${i.quantity}`).join()} cart={cart} />
}

function OrderLines({ cart }: { cart: Cart }) {
  const { cartStore } = useShopkitContext()
  const { pending } = useCart()
  const { isLoggedIn } = useSession()
  const [error, setError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { lines: Object.fromEntries(cart.items.map((item) => [item.id, String(item.quantity)])) },
    onSubmit: async ({ value }) => {
      setError(null)
      for (const item of cart.items) {
        const next = Number.parseInt(value.lines[item.id] ?? "", 10)
        const quantity = Number.isFinite(next) && next > 0 ? next : 0
        if (quantity === item.quantity) continue
        const updated = await cartStore.updateItem(item.id, quantity)
        if (!updated) {
          setError(errorMessage(cartStore.getSnapshot().error, "Some quantities couldn't be updated."))
          return
        }
      }
    },
  })

  const units = cart.itemCount

  return (
    <div className="order">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        <div className="order__update">
          <form.Subscribe selector={(s) => ({ dirty: s.isDirty, submitting: s.isSubmitting, canSubmit: s.canSubmit })}>
            {({ dirty, submitting, canSubmit }) => (
              <button type="submit" className="button button--ghost" disabled={!dirty || submitting || !canSubmit}>
                {submitting ? "Updating…" : "Update quantities"}
              </button>
            )}
          </form.Subscribe>
          <button type="button" className="link-button" disabled={pending > 0} onClick={() => void cartStore.clear()}>
            Clear order sheet
          </button>
        </div>
        <div className="order-table-scroll">
          <table className="order-table">
            <thead>
              <tr>
                <th scope="col" colSpan={2}>
                  Style
                </th>
                <th scope="col">SKU</th>
                <th scope="col" className="num">
                  Unit ex. moms
                </th>
                <th scope="col" className="num">
                  Units
                </th>
                <th scope="col" className="num">
                  Line ex. moms
                </th>
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {cart.items.map((item) => (
                <tr key={item.id} className={item.available ? "" : "is-unavailable"}>
                  <td className="order-table__thumb">
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={applyImageTransform(item.imageUrl, { width: 96, height: 120, fit: "crop" })} alt="" width={48} height={60} loading="lazy" />
                    ) : null}
                  </td>
                  <td>
                    <span className="order-table__name">{item.productTitle}</span>
                    {item.variantName && <span className="order-table__variant">{item.variantName}</span>}
                    {!item.available && <span className="order-table__warn">No longer available</span>}
                  </td>
                  <td className="mono">{item.sku}</td>
                  <td className="num">{money(item.unitPriceExclTax, cart.currency)}</td>
                  <td className="num">
                    <form.Field
                      name={`lines.${item.id}`}
                      validators={{
                        onChange: ({ value }) => (/^\d*$/.test(value.trim()) ? undefined : "Whole numbers"),
                      }}
                    >
                      {(field) => (
                        <input
                          className="qty-input qty-input--line"
                          inputMode="numeric"
                          autoComplete="off"
                          aria-label={`Units, ${item.productTitle} ${item.variantName ?? ""}`}
                          aria-invalid={field.state.meta.errors.length > 0}
                          value={field.state.value ?? ""}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      )}
                    </form.Field>
                  </td>
                  <td className="num">{money(item.lineTotalExclTax, cart.currency)}</td>
                  <td>
                    <button
                      type="button"
                      className="remove"
                      aria-label={`Remove ${item.productTitle} ${item.variantName ?? ""}`}
                      disabled={pending > 0}
                      onClick={() => void cartStore.removeItem(item.id)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && (
          <p role="alert" className="form-card__error">
            {error}
          </p>
        )}
      </form>

      <aside className="totals">
        <dl>
          <div>
            <dt>Units</dt>
            <dd>{units}</dd>
          </div>
          <div>
            <dt>Subtotal ex. moms</dt>
            <dd>{money(cart.subtotalExclTax, cart.currency)}</dd>
          </div>
          {cart.totalDiscount > 0 && (
            <div>
              <dt>Discount</dt>
              <dd>−{money(cart.totalDiscount, cart.currency)}</dd>
            </div>
          )}
          <div>
            <dt>Moms</dt>
            <dd>{money(cart.totalTax, cart.currency)}</dd>
          </div>
          <div className="totals__grand">
            <dt>Total incl. moms</dt>
            <dd>{money(cart.totalInclTax, cart.currency)}</dd>
          </div>
        </dl>
        <p className="totals__note">Shipping is chosen at checkout.</p>
        {isLoggedIn ? (
          <CheckoutButton cartId={cart.id} />
        ) : (
          <p className="grid-form__locked">
            <Link href="/login">Sign in</Link> to check out.
          </p>
        )}
      </aside>
    </div>
  )
}

function CheckoutButton({ cartId }: { cartId: string }) {
  const { redirectToCheckout, starting, error } = useCheckout()
  const { pending } = useCart()

  return (
    <>
      <button
        type="button"
        className="button button--block button--stamp"
        disabled={starting || pending > 0}
        onClick={() => {
          const origin = window.location.origin
          void redirectToCheckout({
            cartId,
            successUrl: `${origin}/success`,
            cancelUrl: `${origin}/order`,
            backUrl: `${origin}/`,
            language: "en",
          })
        }}
      >
        {starting ? "Preparing checkout…" : "Place order →"}
      </button>
      {error && (
        <p role="alert" className="form-card__error">
          {errorMessage(error, "Couldn't start the checkout. Please try again.")}
        </p>
      )}
    </>
  )
}

/** The order sheet's own layout with placeholder rows, so the real one drops in without moving. */
function OrderSheetSkeleton() {
  return (
    <div className="order" aria-busy>
      <div>
        <div className="order__update">
          <Skeleton width={190} height={54} />
          <Skeleton width={120} height={14} />
        </div>
        <div className="order-table-scroll">
          <table className="order-table">
            <thead>
              <tr>
                <th scope="col" colSpan={2}>
                  Style
                </th>
                <th scope="col">SKU</th>
                <th scope="col" className="num">
                  Unit ex. moms
                </th>
                <th scope="col" className="num">
                  Units
                </th>
                <th scope="col" className="num">
                  Line ex. moms
                </th>
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[0, 1].map((row) => (
                <tr key={row}>
                  <td className="order-table__thumb">
                    <Skeleton width={48} height={60} style={{ display: "block" }} />
                  </td>
                  <td>
                    <Skeleton width={160} height={16} style={{ display: "block", marginBottom: 6 }} />
                    <Skeleton width={100} height={13} style={{ display: "block" }} />
                  </td>
                  <td>
                    <Skeleton width={80} height={13} />
                  </td>
                  <td className="num">
                    <Skeleton width={70} height={15} />
                  </td>
                  <td className="num">
                    <Skeleton width={80} height={40} />
                  </td>
                  <td className="num">
                    <Skeleton width={80} height={15} />
                  </td>
                  <td>
                    <Skeleton width={34} height={34} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="totals">
        <dl>
          {["Units", "Subtotal ex. moms", "Moms"].map((label) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <Skeleton width={80} height={15} />
              </dd>
            </div>
          ))}
          <div className="totals__grand">
            <dt>Total incl. moms</dt>
            <dd>
              <Skeleton width={130} height={30} />
            </dd>
          </div>
        </dl>
        <p className="totals__note">Shipping is chosen at checkout.</p>
        <Skeleton width="100%" height={58} style={{ display: "block" }} />
      </aside>
    </div>
  )
}
