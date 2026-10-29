import { notFound } from "next/navigation";
import { Suspense } from "react";
import ProductDetails from "@/components/product-details";
import { productBySlug } from "@/lib/catalog";
import { getCatalog } from "@/lib/shopkit";
import "@/components/product-details.css";

export async function generateStaticParams() {
  const { products } = await getCatalog(null);
  // Cache Components needs at least one param; an empty shop renders a 404.
  if (products.length === 0) return [{ slug: "none" }];
  return products.map((product) => ({ slug: product.slug ?? product.id }));
}

async function ProductContent({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // In the shop's own currency: the price structured data publishes must be
  // the one the checkout charges. The visible page is priced for the shopper.
  const product = productBySlug(await getCatalog(null), slug);
  if (!product) notFound();
  return <ProductDetails product={product} key={product.id} />;
}

export default function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div
          className="product-page pdp-loading"
          role="status"
          aria-label="Loading product"
        >
          <div className="pdp-layout" aria-hidden="true">
            <div className="pdp-loading-photo" />
            <div className="pdp-loading-copy">
              <div className="pdp-loading-line" />
              <div className="pdp-loading-line pdp-loading-title" />
              <div className="pdp-loading-line" />
              <div className="pdp-loading-line pdp-loading-description" />
              <div className="pdp-loading-line pdp-loading-button" />
            </div>
          </div>
        </div>
      }
    >
      <ProductContent params={params} />
    </Suspense>
  );
}
