import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { ProductDetail } from "@/components/ProductDetail"
import { getProductBySlug, getProducts } from "@/lib/shopkit"

type Params = { params: Promise<{ slug: string }> }

export async function generateStaticParams() {
  const products = await getProducts()
  return products.filter((p) => p.slug).map((p) => ({ slug: p.slug! }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const product = await getProductBySlug((await params).slug)
  if (!product) return { title: "Sign not found", robots: { index: false } }
  return {
    title: product.seoTitle ?? product.name ?? undefined,
    description: product.seoDescription ?? product.description?.replace(/<[^>]+>/g, "").slice(0, 160),
  }
}

export default function ProductPage({ params }: Params) {
  return (
    <main className="product-page">
      <Suspense fallback={<div className="product-skeleton" />}>
        <Product params={params} />
      </Suspense>
    </main>
  )
}

async function Product({ params }: Params) {
  const product = await getProductBySlug((await params).slug)
  if (!product) notFound()
  return <ProductDetail product={product} />
}
