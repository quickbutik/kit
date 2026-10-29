"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  plainText,
  type Product,
  type VariantOptionGroupState,
} from "@quickbutik/kit";
import {
  ProductProvider,
  SEO,
  useCart,
  useProductAddToCart,
  useProductState,
} from "@quickbutik/kit/react";
import { maxItemQuantity, quantityInCart } from "@/lib/cart";
import {
  categoryPath,
  colorImageId,
  colorOption,
  comparePrice,
  isNew,
  productById,
  productType,
  relatedProducts,
  sizeOption,
  swatch,
} from "@/lib/catalog";
import Icon from "./icons";
import Modal from "./modal";
import ProductPhoto from "./product-photo";
import ProductCard from "./product-card";
import ProductSizeGuide from "./product-size-guide";
import { usePreferences } from "./store-preferences";
import { useStore } from "./store-context";
import "./product-details.css";

// `product` is in the shop's own currency, for structured data; the page shows
// the store catalog's copy, priced in the shopper's currency.
export default function ProductDetails({ product }: { product: Product }) {
  const { catalog } = useStore();
  const priced = productById(catalog, product.id) ?? product;
  return (
    <ProductProvider
      // The provider keeps the product it mounted with, so a currency switch
      // mounts a new one.
      key={priced.currency}
      product={priced}
      initialVariantId={
        product.variants.length === 1 ? product.variants[0].id : undefined
      }
    >
      <ProductView seoProduct={product} />
    </ProductProvider>
  );
}

function ProductView({ seoProduct }: { seoProduct: Product }) {
  const { price, t, href } = usePreferences();
  const { catalog, favorites, toggleFavorite, openBag } = useStore();
  const { cart } = useCart();
  const state = useProductState();
  const { addToCart, canAddToCart, pending, error } = useProductAddToCart();
  const { product, options, selectedVariant } = state;
  const name = product.name ?? "";
  const colorGroup = options.find((group) =>
    colorOption.test(group.name ?? ""),
  );
  const choiceGroups = options.filter((group) => group !== colorGroup);
  const photoId = colorImageId(product, {
    valueId: colorGroup?.selectedValueId,
  });
  const sizeGroup = options.find((group) => sizeOption.test(group.name ?? ""));
  const [quantity, setQuantity] = useState(1);
  const [sizeGuide, setSizeGuide] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [stickyVisible, setStickyVisible] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [shareLink, setShareLink] = useState("");
  const purchase = useRef<HTMLDivElement>(null);
  const choicesRef = useRef<HTMLFieldSetElement>(null);
  const saved = favorites.includes(product.id);
  const type = productType(catalog, product);
  const soldOut = options.some((group) =>
    group.values.some((value) => value.selected && !value.available),
  );
  const remaining = selectedVariant
    ? maxItemQuantity - quantityInCart(cart, selectedVariant.id)
    : maxItemQuantity;
  const requestedQuantity = Math.min(quantity, Math.max(remaining, 1));
  // Single-value groups are preselected below, so they never need asking for.
  const missing = options.find(
    (group) => group.selectedValueId === null && group.values.length > 1,
  );
  const shownPrice = state.price.amount ?? state.price.min;
  const priceLabel =
    shownPrice === null
      ? ""
      : state.price.amount === null && state.price.isRange
        ? t("From {price}", { price: price(shownPrice, state.currency) })
        : price(shownPrice, state.currency);
  // The selected variant's own "before" price; until one is picked, the
  // product's, unless the reachable variants span a range of prices.
  const beforePrice =
    state.price.amount !== null
      ? state.price.compareAtAmount
      : state.price.isRange
        ? null
        : comparePrice(product);
  const buttonLabel = soldOut
    ? "SOLD OUT"
    : remaining <= 0
      ? "BAG LIMIT REACHED"
      : pending > 0
        ? "ADDING…"
        : missing
          ? missing === colorGroup
            ? "SELECT YOUR COLOR"
            : "SELECT YOUR SIZE"
          : "ADD TO BAG";

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setStickyVisible(!entry.isIntersecting),
      { rootMargin: "-100px 0px 0px 0px" },
    );
    if (purchase.current) observer.observe(purchase.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // Options with a single value (one colour) need no choice from the shopper.
    for (const group of options)
      if (group.values.length === 1 && group.selectedValueId === null)
        state.select(group.id, group.values[0].id);
  }, [options, state]);

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!canAddToCart || soldOut || remaining <= 0) return;
    if (await addToCart(requestedQuantity)) {
      setQuantity(1);
      openBag();
    }
  }
  function stickyPurchase() {
    if (!missing) void submit();
    else {
      choicesRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      choicesRef.current
        ?.querySelector<HTMLInputElement>("input")
        ?.focus({ preventScroll: true });
    }
  }
  async function share() {
    const url = window.location.href.split("#")[0];
    if (navigator.share) {
      try {
        await navigator.share({
          title: name,
          text: plainText(product.description, 200),
          url,
        });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("Link copied.");
      setShareLink("");
    } catch {
      setShareLink(url);
      setShareStatus("Copy this link to share.");
    }
  }

  function optionLabel(group: VariantOptionGroupState) {
    return sizeOption.test(group.name ?? "")
      ? t("SELECT SIZE")
      : t(group.name ?? "").toUpperCase();
  }
  const selectedName = (group: VariantOptionGroupState) =>
    group.values.find((value) => value.id === group.selectedValueId)?.name;

  return (
    <div className="product-page">
      <SEO
        product={seoProduct}
        breadcrumbs={[
          { name: t("Home"), url: href("/") },
          ...(type
            ? [{ name: t(type.name), url: href(categoryPath(type.slug)) }]
            : []),
          { name },
        ]}
      />
      <nav className="product-breadcrumbs" aria-label={t("Breadcrumbs")}>
        <Link href={href("/")}>{t("Home")}</Link>
        <span aria-hidden="true">/</span>
        {type && (
          <>
            <Link href={href(categoryPath(type.slug))}>{t(type.name)}</Link>
            <span aria-hidden="true">/</span>
          </>
        )}
        <span aria-current="page">{name}</span>
      </nav>
      <article className="pdp-layout" aria-labelledby="product-title">
        <div className="pdp-visual">
          <button
            className="pdp-photo"
            onClick={() => {
              setZoom(1);
              setImageOpen(true);
            }}
            aria-label={t("Enlarge image of {name}", { name })}
            aria-haspopup="dialog"
          >
            <ProductPhoto
              product={product}
              imageId={photoId}
              sizes="(max-width: 850px) 100vw, 55vw"
              eager
            />
            {isNew(catalog, product) && (
              <span className="product-badge badge-new">{t("NEW")}</span>
            )}
            <span className="pdp-image-action">
              <Icon name="plus" size={16} />
              {t("VIEW IMAGE")}
            </span>
          </button>
          <div className="pdp-photo-caption">
            <span>{t("THE DAILY ROTATION")}</span>
            <span>{product.id.replace(/^prod_/, "")} / SWEATBRAND</span>
          </div>
        </div>
        <div className="pdp-copy">
          <p className="eyebrow pdp-category">
            {type ? `${t(type.name)} / ` : ""}
            {t("THE EVERYDAY EDIT")}
          </p>
          <h1 id="product-title">{name}</h1>
          <p className="pdp-price">
            {beforePrice === null ? (
              priceLabel
            ) : (
              <>
                <span className="sale-price">
                  <span className="sr-only">{t("Sale price")} </span>
                  {priceLabel}
                </span>
                <s className="before-price">
                  <span className="sr-only">{t("Previous price")} </span>
                  {price(beforePrice, state.currency)}
                </s>
              </>
            )}
          </p>
          {product.description && (
            // Merchant-authored HTML from the Quickbutik admin.
            <div
              className="pdp-description"
              dangerouslySetInnerHTML={{ __html: product.description }}
            />
          )}
          <form
            className="pdp-purchase"
            id="product-purchase"
            onSubmit={submit}
          >
            {colorGroup && (
              <div className="pdp-color">
                <span className="eyebrow">
                  {t("COLOR:")}{" "}
                  <strong>{t(selectedName(colorGroup) ?? "")}</strong>
                </span>
                {colorGroup.values.length === 1 ? (
                  <ColorSwatch color={colorGroup.values[0].name ?? ""} />
                ) : (
                  <div className="pdp-swatches" role="radiogroup">
                    {colorGroup.values.map((value) => (
                      <button
                        type="button"
                        key={value.id}
                        role="radio"
                        aria-checked={value.selected}
                        aria-disabled={!value.available}
                        aria-label={t(value.name ?? "")}
                        className="pdp-swatch-choice"
                        onClick={() => state.select(colorGroup.id, value.id)}
                      >
                        <ColorSwatch
                          color={value.name ?? ""}
                          selected={value.selected}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {choiceGroups.map((group) => (
              <fieldset
                key={group.id}
                ref={group === choiceGroups[0] ? choicesRef : undefined}
                className="pdp-size-field"
              >
                <legend className="sr-only">{optionLabel(group)}</legend>
                <div className="size-heading">
                  <span>
                    {optionLabel(group)}
                    {selectedName(group) && ` / ${t(selectedName(group)!)}`}
                  </span>
                  {group === sizeGroup && (
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => setSizeGuide(true)}
                    >
                      {t("Size guide")}
                    </button>
                  )}
                </div>
                <div className="size-options">
                  {group.values.map((value) => (
                    <label
                      className="pdp-size-option"
                      key={value.id}
                      data-unavailable={!value.available || undefined}
                    >
                      <input
                        className="sr-only"
                        type="radio"
                        name={`option-${group.id}`}
                        value={value.id}
                        checked={value.selected}
                        aria-disabled={!value.available}
                        onChange={() => {
                          state.select(group.id, value.id);
                          setQuantity(1);
                        }}
                        required
                      />
                      <span>{t(value.name ?? "")}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <div className="pdp-quantity-row">
              <span>{t("Quantity")}</span>
              <div className="quantity-control">
                <button
                  type="button"
                  disabled={requestedQuantity <= 1 || remaining <= 0}
                  aria-label={t("Decrease quantity of {name}", { name })}
                  onClick={() => setQuantity(requestedQuantity - 1)}
                >
                  <Icon name="minus" size={14} />
                </button>
                <span aria-live="polite">{requestedQuantity}</span>
                <button
                  type="button"
                  disabled={requestedQuantity >= remaining}
                  aria-label={t("Increase quantity of {name}", { name })}
                  onClick={() => setQuantity(requestedQuantity + 1)}
                >
                  <Icon name="plus" size={14} />
                </button>
              </div>
            </div>
            <div className="pdp-actions" ref={purchase}>
              <button
                className="button button-dark add-bag-button"
                type="submit"
                disabled={!canAddToCart || soldOut || remaining <= 0}
              >
                {t(buttonLabel)}
                <Icon name="bag" size={20} />
              </button>
              <button
                type="button"
                className={`pdp-save ${saved ? "is-saved" : ""}`}
                aria-pressed={saved}
                aria-label={t("{action} {name}", {
                  action: t(saved ? "Unsave" : "Save"),
                  name,
                })}
                onClick={() => toggleFavorite(product.id)}
              >
                <Icon name="heart" size={21} />
              </button>
            </div>
            <p className="pdp-limit-note" role="status">
              {error
                ? t("We couldn’t add this to your bag. Please try again.")
                : remaining <= 0
                  ? t(
                      "You already have the maximum of {count} in this size in your bag.",
                      { count: maxItemQuantity },
                    )
                  : ""}
            </p>
          </form>
          <div className="pdp-delivery">
            <p>
              <Icon name="truck" size={19} />
              {t("Choose your shipping at checkout")}
            </p>
            <p>
              <Icon name="return" size={19} />
              {t("Easy returns within 30 days")}
            </p>
          </div>
          <div className="pdp-accordions">
            <details>
              <summary>
                {t("Care guide")}
                <Icon name="plus" size={18} />
              </summary>
              <div>
                <p>{t("Cold wash with similar colors. Air dry.")}</p>
                <p>{t("Always follow the garment’s care label.")}</p>
                <Link className="pdp-guide-link" href={href("/washing-guide")}>
                  {t("VIEW THE WASHING GUIDE")}
                  <Icon name="arrow" size={16} />
                </Link>
              </div>
            </details>
            <details>
              <summary>
                {t("Shipping & returns")}
                <Icon name="plus" size={18} />
              </summary>
              <div>
                <p>
                  {t(
                    "Shipping options and prices are shown in the checkout before you pay.",
                  )}
                </p>
                <p>{t("Returns within 30 days in unworn condition.")}</p>
              </div>
            </details>
          </div>
          <div className="pdp-share">
            <span className="eyebrow">{t("GOOD FINDS ARE FOR SHARING.")}</span>
            <button type="button" onClick={share}>
              {t("Share product")}
              <Icon name="arrow-up" size={14} />
            </button>
          </div>
          <p className="pdp-share-status" role="status">
            {shareStatus && t(shareStatus)}
          </p>
          {shareLink && (
            <input
              className="pdp-share-link"
              aria-label={t("Product link")}
              value={shareLink}
              readOnly
              onFocus={(event) => event.target.select()}
            />
          )}
        </div>
      </article>
      <section className="pdp-related" aria-labelledby="related-title">
        <div className="pdp-related-heading">
          <div>
            <p className="eyebrow">{t("GOOD TOGETHER")}</p>
            <h2 id="related-title">{t("KEEP THE ROTATION GOING.")}</h2>
          </div>
          <Link href={href("/#shop")}>
            {t("EXPLORE ALL ESSENTIALS")}
            <Icon name="arrow" size={17} />
          </Link>
        </div>
        <div className="product-grid">
          {relatedProducts(catalog, product).map((item) => (
            <ProductCard key={item.id} product={item} />
          ))}
        </div>
      </section>
      {stickyVisible && (
        <div className="pdp-mobile-buy">
          <div>
            <strong>{priceLabel}</strong>
            <span>
              {missing
                ? optionLabel(missing)
                : `${choiceGroups.map((group) => t(selectedName(group) ?? "")).join(" / ")} / ${requestedQuantity}`}
            </span>
          </div>
          <button
            className="button button-dark"
            type="button"
            onClick={stickyPurchase}
            disabled={soldOut || remaining <= 0 || pending > 0}
          >
            {t(buttonLabel)}
            <Icon name="bag" size={17} />
          </button>
        </div>
      )}
      {sizeGuide && sizeGroup && (
        <Modal label={t("Size guide")} onClose={() => setSizeGuide(false)}>
          <ProductSizeGuide
            name={name}
            sizes={sizeGroup.values.map((value) => value.name ?? "")}
            onNavigate={() => setSizeGuide(false)}
          />
        </Modal>
      )}
      {imageOpen && (
        <Modal label={name} onClose={() => setImageOpen(false)} wide>
          <div className="product-zoom-controls">
            <button
              className="icon-button"
              disabled={zoom <= 1}
              onClick={() => setZoom(zoom - 0.5)}
              aria-label={t("Zoom out")}
            >
              <Icon name="minus" />
            </button>
            <span aria-live="polite">{zoom * 100}%</span>
            <button
              className="icon-button"
              disabled={zoom >= 3}
              onClick={() => setZoom(zoom + 0.5)}
              aria-label={t("Zoom in")}
            >
              <Icon name="plus" />
            </button>
          </div>
          <div className="product-zoom-viewport">
            <div
              className="product-zoom-image"
              style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
            >
              <ProductPhoto
                product={product}
                imageId={photoId}
                sizes="(max-width: 640px) 200vw, 1600px"
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ColorSwatch({
  color,
  selected = true,
}: {
  color: string;
  selected?: boolean;
}) {
  const known = swatch(color);
  if (!known) return null;
  return (
    <span
      className="pdp-swatch"
      style={{ background: known.color }}
      aria-hidden="true"
    >
      {selected && (
        <Icon
          name="check"
          size={14}
          style={{ color: known.light ? "#252a2d" : "#fff" }}
        />
      )}
    </span>
  );
}
