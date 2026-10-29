import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { Designer } from "@/components/designer/Designer"
import { getProductBySlug, getProducts } from "@/lib/shopkit"

type Params = { params: Promise<{ slug: string }> }

export async function generateStaticParams() {
  const products = await getProducts()
  return products.filter((p) => p.slug).map((p) => ({ slug: p.slug! }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const product = await getProductBySlug((await params).slug)
  return { title: product ? `Design your ${product.name}` : "Designer", robots: { index: false } }
}

export default function DesignPage({ params }: Params) {
  return (
    <Suspense fallback={<div className="designer-loading">Loading the designer…</div>}>
      <DesignerFor params={params} />
    </Suspense>
  )
}

async function DesignerFor({ params }: Params) {
  const product = await getProductBySlug((await params).slug)
  if (!product) notFound()
  return <Designer product={product} />
}
