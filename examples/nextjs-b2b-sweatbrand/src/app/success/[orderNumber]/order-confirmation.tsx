"use client"

import { useOrderConfirmation } from "@quickbutik/kit/react"
import Link from "next/link"
import { use } from "react"

export function OrderConfirmation({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber: fromUrl } = use(params)
  // Uses the checkout session the kit remembered when the checkout started.
  const { status, orderNumber, outcome, loading, error } = useOrderConfirmation()
  const shown = orderNumber ?? fromUrl

  let message: React.ReactNode
  if (status === "failed" || outcome?.kind === "failed") {
    message = (
      <>
        The payment didn&apos;t go through and no order was created. Your order sheet is still saved —{" "}
        <Link href="/order">try again</Link>.
      </>
    )
  } else if (loading) {
    message = "Confirming your order…"
  } else if (error || outcome?.kind === "timeout") {
    // A timeout is not a failure: the payment is registered, the order is still being created.
    message = `Order no. ${shown} — your payment is registered and the order will appear shortly. A confirmation is on its way to your email.`
  } else {
    message = `Order no. ${shown} is confirmed. A confirmation is on its way to your email.`
  }

  return (
    <div className="form-card">
      <p className="receipt-no">No. {shown}</p>
      <p>{message}</p>
      <p className="form-card__aside">
        <Link href="/">← Back to the catalogue</Link>
      </p>
    </div>
  )
}
