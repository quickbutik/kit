import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ProductSheet } from "@/components/product-sheet"
import { getCatalog, getProductBySlug } from "@/lib/catalog"

export async function generateStaticParams() {
  const products = await getCatalog()
  return products.filter((p) => p.slug).map((p) => ({ slug: p.slug! }))
}

export async function generateMetadata({ params }: PageProps<"/products/[slug]">): Promise<Metadata> {
  const product = await getProductBySlug((await params).slug)
  if (!product) return { title: "Style not found", robots: { index: false } }
  return {
    title: product.seoTitle ?? product.name ?? undefined,
    description: product.seoDescription ?? undefined,
    openGraph: product.images[0]?.url ? { images: [product.images[0].url] } : undefined,
  }
}

export default async function ProductPage({ params }: PageProps<"/products/[slug]">) {
  const { slug } = await params
  const catalog = await getCatalog()
  const index = catalog.findIndex((p) => p.slug === slug)
  if (index === -1) notFound()

  return (
    <div className="product-page">
      <p className="crumbs">
        <Link href="/">Catalogue</Link> <span aria-hidden>/</span> {catalog[index].name}
      </p>
      <ProductSheet product={catalog[index]} index={index} detailed />
    </div>
  )
}
