import { Suspense } from "react";
import SearchResults from "@/components/search-results";
import { requestCurrency, searchProducts } from "@/lib/shopkit";

async function SearchContent({ searchParams }: PageProps<"/[locale]/search">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim().slice(0, 100) : "";
  const products = query
    ? await searchProducts(query, await requestCurrency())
    : [];
  return <SearchResults query={query} products={products} />;
}

export default function SearchPage(props: PageProps<"/[locale]/search">) {
  return (
    <Suspense
      fallback={<div className="shop-section" role="status" aria-busy />}
    >
      <SearchContent {...props} />
    </Suspense>
  );
}
