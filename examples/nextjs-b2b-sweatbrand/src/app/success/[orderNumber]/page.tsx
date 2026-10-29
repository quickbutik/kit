import type { Metadata } from "next"
import { Suspense } from "react"
import { Skeleton, SkeletonText } from "@/components/skeleton"
import { OrderConfirmation } from "./order-confirmation"

export const metadata: Metadata = { title: "Order received", robots: { index: false, follow: false } }

export default function SuccessPage({ params }: PageProps<"/success/[orderNumber]">) {
  return (
    <section className="form-page">
      <header className="form-page__head">
        <p className="eyebrow">Thank you</p>
        <h1 className="form-page__title">Order received</h1>
      </header>
      <Suspense
        fallback={
          <div className="form-card" aria-busy>
            <Skeleton width={160} height={40} />
            <SkeletonText lines={2} lineHeight="1.5em" />
            <p className="form-card__aside">
              <Skeleton width={170} height={14} />
            </p>
          </div>
        }
      >
        <OrderConfirmation params={params} />
      </Suspense>
    </section>
  )
}
