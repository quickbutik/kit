import type { Metadata } from "next"
import { CartView } from "@/components/CartView"

export const metadata: Metadata = { title: "Your cart", robots: { index: false } }

export default function CartPage() {
  return (
    <main className="cart-page">
      <h1>Your cart</h1>
      <CartView />
    </main>
  )
}
