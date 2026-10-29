"use client";

import { SEO } from "@quickbutik/kit/react";
import ProductListing from "./product-listing";
import { usePreferences } from "./store-preferences";
import { useStore } from "./store-context";

export default function SavedProducts() {
  const { t } = usePreferences();
  const { catalog, favorites } = useStore();
  return (
    <section className="shop-section" aria-labelledby="saved-heading">
      <SEO title={t("Saved")} noIndex />
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            <span className="mini-square" />
            {t(" SAVED IN THIS BROWSER")}
          </p>
          <h1 id="saved-heading">
            {t("YOUR FAVORITES")}
            <span className="heading-period">.</span>
          </h1>
        </div>
      </div>
      <ProductListing
        products={catalog.products.filter((product) =>
          favorites.includes(product.id),
        )}
        empty={{
          icon: "heart",
          title: t("Make room for your favorites."),
          text: t("Tap a heart on anything you love. It’ll be waiting here."),
        }}
      />
    </section>
  );
}
