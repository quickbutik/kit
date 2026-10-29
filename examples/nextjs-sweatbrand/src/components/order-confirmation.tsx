"use client";

import Link from "next/link";
import { useEffect } from "react";
import { SEO, useCart, useOrderConfirmation } from "@quickbutik/kit/react";
import Icon from "./icons";
import { usePreferences } from "./store-preferences";
import { useStore } from "./store-context";

export default function OrderConfirmation({
  orderNumberFromUrl,
}: {
  orderNumberFromUrl: number | null;
}) {
  const { t, href } = usePreferences();
  const { catalog, openBag } = useStore();
  const { refresh } = useCart();
  // Polls the checkout session the bag started, until the order exists.
  const { status, orderNumber, outcome, loading } = useOrderConfirmation();
  const shown = orderNumber ?? orderNumberFromUrl;
  const failed = status === "failed" || outcome?.kind === "failed";
  const completed = outcome?.kind === "completed";

  useEffect(() => {
    // A completed checkout forgets the bought cart; show the empty bag.
    if (completed) void refresh();
  }, [completed, refresh]);

  let title = t("ALMOST IN YOUR ROTATION.");
  let text = t("We’re creating your order. This usually takes a few seconds.");
  if (failed) {
    title = t("THAT DIDN’T GO THROUGH.");
    text = t(
      "Your payment wasn’t completed, so no order has been created. Your bag is still saved.",
    );
  } else if (completed) {
    title = t("GOOD ENERGY, CONFIRMED");
    text = shown
      ? t(
          "Order #{number} is confirmed. A confirmation is on its way to your inbox.",
          {
            number: shown,
          },
        )
      : t(
          "Your order is confirmed. A confirmation is on its way to your inbox.",
        );
  } else if (!loading) {
    // A timeout is not a failure: the order can still land.
    text = shown
      ? t(
          "We’re still confirming order #{number}. You’ll get an email as soon as it’s ready.",
          {
            number: shown,
          },
        )
      : t(
          "We’re still confirming your order. You’ll get an email as soon as it’s ready.",
        );
  }

  return (
    <div className="order-page order-confirmation" aria-live="polite">
      {/* One shopper's private page: never index it. */}
      <SEO title={t("Thank you")} noIndex noFollow />
      <span className="confirmation-icon">
        <Icon name={failed ? "close" : "check"} size={35} />
      </span>
      <h1>{title}</h1>
      <p role={loading ? "status" : undefined}>{text}</p>
      {catalog.shop.demo && (
        <p className="demo-note">
          {t("The checkout is in demo mode, so no payment was taken.")}
        </p>
      )}
      {failed ? (
        <button className="button button-dark" onClick={openBag}>
          {t("BACK TO YOUR BAG ")}
          <Icon name="bag" />
        </button>
      ) : (
        <Link className="button button-dark" href={href("/#shop")}>
          {t("BACK TO THE GOOD STUFF ")}
          <Icon name="arrow" />
        </Link>
      )}
    </div>
  );
}
