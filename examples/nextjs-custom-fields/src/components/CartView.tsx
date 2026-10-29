"use client"

import { useCart, useCheckout } from "@quickbutik/kit/react"
import Link from "next/link"
import { designIdFromValue, designPreviewPath } from "@/lib/design-links"
import { money } from "@/lib/signs"
import { ArrowRightIcon, MinusIcon, PlusIcon, TrashIcon } from "./icons"

export function CartView() {
  const { cart, status, pending, updateItem, removeItem, error } = useCart()
  const checkout = useCheckout()

  if (status === "idle" || (status === "loading" && !cart)) {
    return <div className="cart-skeleton" aria-busy="true" />
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="cart-empty">
        <p>Your cart is empty — every sign starts with a blank canvas.</p>
        <Link href="/#signs" className="btn btn-primary">
          Choose a sign <ArrowRightIcon />
        </Link>
      </div>
    )
  }

  const currency = cart.currency

  async function goToCheckout() {
    const origin = window.location.origin
    await checkout.redirectToCheckout({
      successUrl: `${origin}/success`,
      cancelUrl: `${origin}/cart`,
      backUrl: `${origin}/`,
      language: "en",
    })
  }

  return (
    <div className="cart-layout">
      <ul className="cart-lines">
        {cart.items.map((item) => {
          const designId = designIdFromValue(item.properties?.find((p) => designIdFromValue(p.value))?.value)
          // A null title means the product's fields changed since the add: checkout refuses the line.
          const stale = item.properties?.some((p) => p.title === null) ?? false
          return (
            <li key={item.id} className="cart-line" data-unavailable={!item.available || undefined}>
              <div className="cart-line-art">
                {designId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={designPreviewPath(designId)} alt={`Your design for ${item.productTitle}`} />
                ) : (
                  <span className="muted">No design</span>
                )}
              </div>
              <div className="cart-line-body">
                <h3>{item.productTitle}</h3>
                <p className="muted">
                  {item.variantName}
                  {designId && " · your custom design"}
                </p>
                {!item.available && <p className="warn-text">No longer available</p>}
                {stale && (
                  <p className="warn-text">This sign has changed since you added it. Remove it and add your design again.</p>
                )}
                <div className="cart-line-actions">
                  <div className="stepper" role="group" aria-label="Quantity">
                    <button
                      onClick={() => updateItem(item.id, item.quantity - 1)}
                      disabled={pending > 0}
                      aria-label="One fewer"
                    >
                      <MinusIcon width={16} height={16} />
                    </button>
                    <output aria-live="polite">{item.quantity}</output>
                    <button
                      onClick={() => updateItem(item.id, item.quantity + 1)}
                      disabled={pending > 0}
                      aria-label="One more"
                    >
                      <PlusIcon width={16} height={16} />
                    </button>
                  </div>
                  <button className="link-btn" onClick={() => removeItem(item.id)} disabled={pending > 0}>
                    <TrashIcon width={16} height={16} /> Remove
                  </button>
                </div>
              </div>
              <p className="cart-line-total">{money(item.lineTotal, currency)}</p>
            </li>
          )
        })}
      </ul>

      <aside className="cart-summary">
        <dl>
          <div>
            <dt>Subtotal</dt>
            <dd>{money(cart.subtotal, currency)}</dd>
          </div>
          <div>
            <dt>Shipping</dt>
            <dd className="muted">Calculated at checkout</dd>
          </div>
          <div className="cart-total">
            <dt>Total</dt>
            <dd>{money(cart.total, currency)}</dd>
          </div>
        </dl>
        {(error || checkout.error) && (
          <p role="alert" className="warn-text">
            {(checkout.error ?? error)?.message}
          </p>
        )}
        <button
          className="btn btn-primary btn-lg btn-block"
          onClick={goToCheckout}
          disabled={checkout.starting || pending > 0}
        >
          {checkout.starting ? "Opening checkout…" : "Checkout"} <ArrowRightIcon />
        </button>
        <p className="muted small">Pay with card, Klarna, Apple Pay and more in the secure checkout.</p>
      </aside>
    </div>
  )
}
