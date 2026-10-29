"use client";

import Link from "next/link";
import { useState } from "react";
import type { Product } from "@quickbutik/kit";
import { sortProducts, type Sort } from "@/lib/catalog";
import Icon from "./icons";
import ProductCard from "./product-card";
import { usePreferences } from "./store-preferences";

export type ListingTab = { label: string; href: string; active: boolean };

export default function ProductListing({
  products,
  tabs = [],
  summary,
  empty,
}: {
  products: Product[];
  tabs?: ListingTab[];
  summary?: string;
  empty: { icon: "search" | "heart"; title: string; text: string };
}) {
  const { t, href } = usePreferences();
  const [sort, setSort] = useState<Sort>("featured");
  const sorted = sortProducts(products, sort);
  return (
    <>
      <div className="shop-toolbar">
        <nav className="category-tabs" aria-label={t("Product categories")}>
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={href(tab.href)}
              className={`category-tab ${tab.active ? "category-active" : ""}`}
              aria-current={tab.active ? "page" : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <div className="toolbar-options">
          <label className="sort-label">
            <span className="sr-only">{t("Sort products")}</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
            >
              <option value="featured">{t("Sort: Featured")}</option>
              <option value="price-low">{t("Price: Low to high")}</option>
              <option value="price-high">{t("Price: High to low")}</option>
              <option value="name">{t("Name: A to Z")}</option>
            </select>
            <Icon name="chevron" size={14} />
          </label>
        </div>
      </div>
      <div className="product-meta-row">
        <span>
          {t("{count} essentials", { count: products.length })}
          {summary ? ` · ${summary}` : ""}
        </span>
        <span>{t("GOOD FITS. BETTER DAYS.")}</span>
      </div>
      <div className="product-grid">
        {sorted.map((product) => (
          <ProductCard product={product} key={product.id} />
        ))}
      </div>
      {products.length === 0 && (
        <div className="empty-state">
          <Icon name={empty.icon} size={35} />
          <h3>{empty.title}</h3>
          <p>{empty.text}</p>
          <Link className="button button-dark" href={href("/#shop")}>
            {t("EXPLORE ALL ESSENTIALS ")}
            <Icon name="arrow" />
          </Link>
        </div>
      )}
    </>
  );
}

// Varied, so the placeholder grid reads like real names and prices.
const tabWidths = [24, 48, 40, 56];
const cardWidths = [
  { name: "62%", price: "17%", subtitle: "44%" },
  { name: "48%", price: "15%", subtitle: "36%" },
  { name: "70%", price: "17%", subtitle: "40%" },
  { name: "54%", price: "19%", subtitle: "48%" },
];

/**
 * ProductListing's shape while its products load: the same toolbar, meta row
 * and grid classes, so the real listing lands without anything moving.
 * Decorative only; the caller announces the loading.
 */
export function ProductListingLoading({ count = 8 }: { count?: number }) {
  const { t } = usePreferences();
  return (
    <div className="listing-loading" aria-hidden="true">
      <div className="shop-toolbar">
        <div className="category-tabs">
          {tabWidths.map((width) => (
            <span className="category-tab" key={width}>
              <span className="skeleton-text" style={{ width }} />
            </span>
          ))}
        </div>
        <div className="toolbar-options">
          <span className="sort-label">
            <span className="skeleton-text skeleton-sort" />
          </span>
        </div>
      </div>
      <div className="product-meta-row">
        <span>
          <span className="skeleton-text" style={{ width: 64 }} />
        </span>
        <span>{t("GOOD FITS. BETTER DAYS.")}</span>
      </div>
      <div className="product-grid">
        {Array.from({ length: count }, (_, index) => {
          const widths = cardWidths[index % cardWidths.length];
          return (
            <div className="product-card" key={index}>
              <div className="product-visual skeleton" />
              <div className="product-info">
                <div className="product-title-row">
                  <span
                    className="skeleton-text"
                    style={{ width: widths.name }}
                  />
                  <span
                    className="skeleton-text"
                    style={{ width: widths.price }}
                  />
                </div>
                <div className="product-subtitle">
                  <span
                    className="skeleton-text"
                    style={{ width: widths.subtitle }}
                  />
                </div>
                <div className="color-label">
                  <span className="color-dots">
                    <i className="skeleton" />
                    <i className="skeleton" />
                    <i className="skeleton" />
                  </span>
                  <span className="skeleton-text" style={{ width: 44 }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
