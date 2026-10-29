"use client";

import Link from "next/link";
import { SEO } from "@quickbutik/kit/react";
import {
  categoryBySlug,
  categoryPath,
  filterCategories,
  productsIn,
} from "@/lib/catalog";
import ProductListing, { ProductListingLoading } from "./product-listing";
import { usePreferences } from "./store-preferences";
import { useStore } from "./store-context";
import "./product-details.css";

export default function CategoryView({
  slug,
  filterSlug,
}: {
  slug: string;
  filterSlug?: string;
}) {
  const { t, href } = usePreferences();
  const { catalog } = useStore();
  const category = categoryBySlug(catalog, slug)!;
  const filters = filterCategories(catalog, category);
  const filter = filters.find((item) => item.slug === filterSlug);
  const products = productsIn(catalog, category, filter);
  const title = t(category.name).toUpperCase();
  return (
    <section
      className="shop-section category-page"
      aria-labelledby="category-heading"
    >
      {/* Filter combinations are near-duplicates: keep them out of the index. */}
      <SEO
        category={category}
        title={
          filter ? `${t(category.name)} / ${t(filter.name)}` : t(category.name)
        }
        noIndex={!!filter}
      />
      <nav className="product-breadcrumbs" aria-label={t("Breadcrumbs")}>
        <Link href={href("/")}>{t("Home")}</Link>
        <span aria-hidden="true">/</span>
        {filter ? (
          <>
            <Link href={href(categoryPath(category.slug))}>
              {t(category.name)}
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{t(filter.name)}</span>
          </>
        ) : (
          <span aria-current="page">{t(category.name)}</span>
        )}
      </nav>
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            <span className="mini-square" />
            {t(" THE COLLECTION")}
          </p>
          <h1 id="category-heading">
            {filter ? `${title} / ${t(filter.name).toUpperCase()}` : title}
            <span className="heading-period">.</span>
          </h1>
        </div>
        <p>
          {t("Gym hours. Street hours. All the hours in between.")}
          <br />
          {t("Meet your new everyday essentials.")}
        </p>
      </div>
      <ProductListing
        products={products}
        tabs={[
          {
            label: t("All"),
            href: categoryPath(category.slug),
            active: !filter,
          },
          ...filters.map((item) => ({
            label: t(item.name),
            href: categoryPath(category.slug, item.slug),
            active: item.id === filter?.id,
          })),
        ]}
        empty={{
          icon: "search",
          title: t("No fits found. Yet."),
          text: t("New pieces are on their way. Check back soon."),
        }}
      />
    </section>
  );
}

/**
 * CategoryView's shape while the category streams in. Every category shares
 * one prefetched shell, so only the copy common to all of them is real.
 */
export function CategoryLoading() {
  const { t } = usePreferences();
  return (
    <div className="shop-section category-page" role="status" aria-busy="true">
      <span className="sr-only">{t("Loading products")}</span>
      <div aria-hidden="true">
        <div className="product-breadcrumbs">
          <span>{t("Home")}</span>
          <span>/</span>
          <span className="skeleton-text" style={{ width: 72 }} />
        </div>
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              <span className="mini-square" />
              {t(" THE COLLECTION")}
            </p>
            <div className="skeleton-title">
              <span className="skeleton-text" style={{ width: "5.5em" }} />
            </div>
          </div>
          <p>
            {t("Gym hours. Street hours. All the hours in between.")}
            <br />
            {t("Meet your new everyday essentials.")}
          </p>
        </div>
      </div>
      <ProductListingLoading />
    </div>
  );
}
