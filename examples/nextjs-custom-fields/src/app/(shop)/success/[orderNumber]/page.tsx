import type { Metadata } from "next"
import { Suspense } from "react"
import { OrderConfirmation } from "@/components/OrderConfirmation"

export const metadata: Metadata = { title: "Thank you", robots: { index: false, follow: false } }

export default function SuccessPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  return (
    <main className="success-page">
      <Suspense fallback={<p className="muted">Confirming your order…</p>}>
        <Confirmation params={params} />
      </Suspense>
    </main>
  )
}

async function Confirmation({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params
  return <OrderConfirmation orderNumberFromUrl={Number.parseInt(orderNumber, 10) || null} />
}
