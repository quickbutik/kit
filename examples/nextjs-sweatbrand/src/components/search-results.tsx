"use client";

import type { Product } from "@quickbutik/kit";
import { SEO } from "@quickbutik/kit/react";
import ProductListing from "./product-listing";
import { usePreferences } from "./store-preferences";

export default function SearchResults({
  query,
  products,
}: {
  query: string;
  products: Product[];
}) {
  const { t } = usePreferences();
  return (
    <section className="shop-section" aria-labelledby="search-heading">
      <SEO title={query ? `${t("Search")}: ${query}` : t("Search")} noIndex />
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            <span className="mini-square" />
            {t(" SEARCH")}
          </p>
          <h1 id="search-heading">
            {query ? `“${query}”` : t("FIND YOUR NEXT FAVORITE")}
            <span className="heading-period">.</span>
          </h1>
        </div>
      </div>
      <ProductListing
        products={products}
        summary={query ? t("Matching “{query}”", { query }) : undefined}
        empty={{
          icon: "search",
          title: t("No fits found. Yet."),
          text: t("No results yet. Try “tee” or “shorts”."),
        }}
      />
    </section>
  );
}
