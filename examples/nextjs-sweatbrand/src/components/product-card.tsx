"use client";

import Link from "next/link";
import { useState } from "react";
import type { Product } from "@quickbutik/kit";
import {
  audiences,
  colorImageId,
  colorOption,
  comparePrice,
  isNew,
  optionChoices,
  productPath,
  productType,
  swatch,
} from "@/lib/catalog";
import Icon from "./icons";
import ProductPhoto from "./product-photo";
import { usePreferences } from "./store-preferences";
import { useStore } from "./store-context";

export default function ProductCard({ product }: { product: Product }) {
  const { price, t, href, htmlLang } = usePreferences();
  const { catalog, favorites, toggleFavorite } = useStore();
  const name = product.name ?? "";
  const saved = favorites.includes(product.id);
  const before = comparePrice(product);
  // Rounded down, so the badge never promises more than the price gives.
  const saving =
    before !== null && product.price !== null
      ? Math.floor((1 - product.price / before) * 100) / 100
      : null;
  const colors = optionChoices(product, colorOption);
  const audience = audiences(catalog, product);
  const type = productType(catalog, product);
  // A hovered dot previews its color; a tapped one stays, for touch.
  const [hovered, setHovered] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  // The other colors' photos load once the shopper reaches for the card.
  const [engaged, setEngaged] = useState(false);
  const shownId = hovered ?? picked;
  const shown = colors.find((color) => color.id === shownId);
  const colorPhotos =
    colors.length > 1
      ? colors.flatMap((color) => {
          const imageId = colorImageId(product, { valueId: color.id });
          return imageId ? [{ colorId: color.id, imageId }] : [];
        })
      : [];
  return (
    <article
      className="product-card"
      onPointerEnter={() => setEngaged(true)}
      onFocus={() => setEngaged(true)}
    >
      <div className="product-visual">
        <Link
          href={href(productPath(product))}
          className="product-photo-button"
          aria-label={t("View {name}", { name })}
        >
          <ProductPhoto product={product} />
          {engaged &&
            colorPhotos.map((photo) => (
              <span
                key={photo.colorId}
                className={`product-color-photo ${shownId === photo.colorId ? "is-shown" : ""}`}
                aria-hidden="true"
              >
                <ProductPhoto product={product} imageId={photo.imageId} />
              </span>
            ))}
        </Link>
        <div className="product-badges">
          {saving !== null && (
            <span className="product-badge badge-sale">
              {new Intl.NumberFormat(htmlLang, { style: "percent" }).format(
                -saving,
              )}
            </span>
          )}
          {isNew(catalog, product) && (
            <span className="product-badge badge-new">{t("NEW")}</span>
          )}
        </div>
        <button
          className={`save-button ${saved ? "is-saved" : ""}`}
          aria-label={t("{action} {name}", {
            action: t(saved ? "Unsave" : "Save"),
            name,
          })}
          aria-pressed={saved}
          onClick={() => toggleFavorite(product.id)}
        >
          <Icon name="heart" size={18} />
        </button>
        <Link
          href={href(`${productPath(product)}#product-purchase`)}
          className="quick-add"
          aria-label={t("Choose size for {name}", { name })}
        >
          <Icon name="plus" size={20} />
          <span>{t("QUICK ADD")}</span>
        </Link>
      </div>
      <div className="product-info">
        <div className="product-title-row">
          <Link href={href(productPath(product))}>{name}</Link>
          {product.price !== null && (
            <span className={before !== null ? "sale-price" : undefined}>
              {before !== null && (
                <span className="sr-only">{t("Sale price")} </span>
              )}
              {price(product.price, product.currency)}
            </span>
          )}
        </div>
        <div className="product-subtitle">
          <span>
            {audience.length === 1 && type
              ? t("{audience}’s {category}", {
                  audience: t(audience[0].name),
                  category: t(type.name).toLowerCase(),
                })
              : t("Everyday essential")}
          </span>
          {before !== null && (
            <s className="before-price">
              <span className="sr-only">{t("Previous price")} </span>
              {price(before, product.currency)}
            </s>
          )}
        </div>
        {colors.length > 0 && (
          <div className="color-label">
            {colors.length === 1 ? (
              swatch(colors[0].name) && (
                <i style={{ background: swatch(colors[0].name)!.color }} />
              )
            ) : (
              <div
                className="color-dots"
                role="group"
                aria-label={t("Colors")}
                onMouseLeave={() => setHovered(null)}
              >
                {colors.map((color) => (
                  <button
                    type="button"
                    key={color.id}
                    className={`color-dot ${shownId === color.id ? "is-shown" : ""}`}
                    style={{ background: swatch(color.name)?.color }}
                    aria-label={t(color.name)}
                    aria-pressed={picked === color.id}
                    onMouseEnter={() => setHovered(color.id)}
                    onFocus={() => setHovered(color.id)}
                    onBlur={() => setHovered(null)}
                    onClick={() => setPicked(color.id)}
                  />
                ))}
              </div>
            )}
            <span>
              {colors.length === 1
                ? t(colors[0].name)
                : shown
                  ? t(shown.name)
                  : t("{count} colors", { count: colors.length })}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
