"use client"

import { useOrderConfirmation } from "@quickbutik/kit/react"
import Link from "next/link"
import { CheckIcon } from "./icons"

export function OrderConfirmation({ orderNumberFromUrl }: { orderNumberFromUrl: number | null }) {
  // No id: the hook uses the checkout session this browser remembered.
  const { status, orderNumber, outcome, loading } = useOrderConfirmation()
  const shown = orderNumber ?? orderNumberFromUrl

  if (status === "failed" || outcome?.kind === "failed") {
    return (
      <div className="success-card">
        <h1>Payment didn&apos;t go through</h1>
        <p>No order was created and you have not been charged. Your designs are still in your cart.</p>
        <Link href="/cart" className="btn btn-primary">
          Back to cart
        </Link>
      </div>
    )
  }

  return (
    <div className="success-card">
      <span className="success-badge" aria-hidden="true">
        <CheckIcon width={28} height={28} />
      </span>
      <h1>{loading ? "Finishing up…" : "Thank you!"}</h1>
      {loading ? (
        <p>We&apos;re creating your order. This usually takes a few seconds.</p>
      ) : outcome?.kind === "timeout" ? (
        <p>
          Order {shown ? `#${shown}` : ""} — your payment is registered and the order will appear shortly. A
          confirmation is on its way to your inbox.
        </p>
      ) : (
        <p>
          Order {shown ? `#${shown}` : ""} is confirmed. Your design is heading to print, and a confirmation is on its
          way to your inbox.
        </p>
      )}
      <Link href="/" className="btn btn-ghost">
        Design another sign
      </Link>
    </div>
  )
}
