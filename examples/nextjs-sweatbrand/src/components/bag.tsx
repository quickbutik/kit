"use client";

import Link from "next/link";
import type { CartItem } from "@quickbutik/kit";
import { useCart, useCheckout } from "@quickbutik/kit/react";
import { maxItemQuantity } from "@/lib/cart";
import { colorImageId, productById, productPath } from "@/lib/catalog";
import Icon from "./icons";
import ProductPhoto from "./product-photo";
import { usePreferences } from "./store-preferences";
import { useStore } from "./store-context";

export default function BagContents({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  const { price, t, href, htmlLang } = usePreferences();
  const { catalog } = useStore();
  const { cart, itemCount, pending, error, updateItem, removeItem } = useCart();
  const checkout = useCheckout();
  const items = cart?.items ?? [];
  const unavailable = items.some((item) => !item.available);

  function startCheckout() {
    if (!cart) return;
    // The hosted Quickbutik checkout takes payment, then returns the shopper
    // to <origin>/success/<orderNumber>.
    void checkout.redirectToCheckout({
      cartId: cart.id,
      successUrl: `${location.origin}/success`,
      cancelUrl: location.href.split("#")[0],
      backUrl: location.origin + href("/"),
      language: htmlLang,
    });
  }

  function variantLabel(item: CartItem) {
    const variant = productById(catalog, item.productId)?.variants.find(
      (candidate) => candidate.id === item.variantId,
    );
    return variant
      ? variant.options.map((value) => t(value.name ?? "")).join(" / ")
      : item.variantName;
  }

  if (items.length === 0)
    return (
      <div className="bag-content">
        <h2>{t("GOOD CHOICES.")}</h2>
        <div className="empty-state">
          <Icon name="bag" size={40} />
          <h3>{t("Your next favorite is out there.")}</h3>
          <p>{t("Give your everyday a fresh rotation.")}</p>
          <Link
            className="button button-dark"
            href={href("/#shop")}
            onNavigate={onNavigate}
          >
            {t("EXPLORE THE COLLECTION ")}
            <Icon name="arrow" />
          </Link>
        </div>
      </div>
    );

  return (
    <div className="bag-content">
      <h2>{t("GOOD CHOICES.")}</h2>
      <div className="bag-items" aria-busy={pending > 0}>
        {items.map((item) => {
          const product = productById(catalog, item.productId);
          const name = item.productTitle ?? product?.name ?? "";
          return (
            <div className="bag-item" key={item.id}>
              {product ? (
                <Link
                  href={href(productPath(product))}
                  className="bag-item-photo"
                  aria-label={t("View {name}", { name })}
                  onNavigate={onNavigate}
                >
                  <ProductPhoto
                    product={product}
                    imageId={colorImageId(product, {
                      variantId: item.variantId,
                    })}
                    sizes="100px"
                  />
                </Link>
              ) : (
                <span className="bag-item-photo" />
              )}
              <div className="bag-item-info">
                <div>
                  <h3>
                    {product ? (
                      <Link
                        href={href(productPath(product))}
                        onNavigate={onNavigate}
                      >
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </h3>
                  <span>{price(item.lineTotal, cart!.currency)}</span>
                </div>
                <p>
                  {item.available
                    ? variantLabel(item)
                    : t("No longer available")}
                </p>
                <div className="bag-item-controls">
                  <div className="quantity-control">
                    <button
                      aria-label={t("Decrease quantity of {name}", { name })}
                      disabled={pending > 0 || !item.available}
                      onClick={() => updateItem(item.id, item.quantity - 1)}
                    >
                      <Icon name="minus" size={13} />
                    </button>
                    <span aria-live="polite">{item.quantity}</span>
                    <button
                      aria-label={t("Increase quantity of {name}", { name })}
                      disabled={
                        pending > 0 ||
                        !item.available ||
                        item.quantity >= maxItemQuantity
                      }
                      onClick={() => updateItem(item.id, item.quantity + 1)}
                    >
                      <Icon name="plus" size={13} />
                    </button>
                  </div>
                  <button
                    className="remove-button"
                    disabled={pending > 0}
                    onClick={() => removeItem(item.id)}
                  >
                    {t("Remove")}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="bag-summary">
        <div>
          <span>{t("Subtotal ({count} items)", { count: itemCount })}</span>
          <span>{price(cart!.subtotal, cart!.currency)}</span>
        </div>
        {cart!.totalDiscount > 0 && (
          <div>
            <span>{t("Discount")}</span>
            <span>−{price(cart!.totalDiscount, cart!.currency)}</span>
          </div>
        )}
        <p>
          {t("Shipping calculated at checkout.")}
          {cart!.presentment?.mode === "display" &&
            ` ${t(
              "Prices in {currency} are converted. You pay in {chargeCurrency} at checkout.",
              {
                currency: cart!.currency,
                chargeCurrency: cart!.presentment.chargeCurrency,
              },
            )}`}
        </p>
        {(error || checkout.error || unavailable) && (
          <p className="bag-error" role="alert">
            {unavailable
              ? t("Remove items that are no longer available to check out.")
              : checkout.error
                ? t("We couldn’t start the checkout. Please try again.")
                : t("We couldn’t update your bag. Please try again.")}
          </p>
        )}
        <button
          className="button button-dark"
          onClick={startCheckout}
          disabled={checkout.starting || pending > 0 || unavailable}
        >
          {t(checkout.starting ? "OPENING CHECKOUT…" : "GO TO CHECKOUT ")}
          <Icon name="arrow" />
        </button>
      </div>
    </div>
  );
}
