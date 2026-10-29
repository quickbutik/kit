import type { Metadata } from "next"
import { OrderSheet } from "./order-sheet"

export const metadata: Metadata = { title: "Order sheet", robots: { index: false } }

export default function OrderPage() {
  return (
    <section className="order-page">
      <header className="order-page__head">
        <p className="eyebrow">Your order</p>
        <h1 className="form-page__title">Order sheet</h1>
      </header>
      <OrderSheet />
    </section>
  )
}
