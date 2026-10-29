"use client";

import { ConsentSettingsButton, SEO } from "@quickbutik/kit/react";
import { usePreferences } from "./store-preferences";

// What this storefront actually stores. The kit's cookies are strictly
// necessary; analytics and marketing wait for the cookie banner.
const cookies = [
  {
    names: ["qb_cart_id", "qb_store_id"],
    purpose: "Remembers your bag with our shop platform, Quickbutik.",
  },
  {
    names: ["qb_checkout_session", "qb_checkout_store"],
    purpose: "Connects you to your checkout so your order can be confirmed.",
  },
  {
    names: ["qb_customer_session"],
    purpose: "Keeps you logged in to your account. Only set while you are.",
  },
  {
    names: ["qb_consent"],
    purpose: "Remembers your cookie choices for 180 days.",
  },
];

export default function PrivacyPolicy() {
  const { t, href, htmlLang } = usePreferences();
  return (
    <section className="shop-section privacy-page" aria-labelledby="privacy">
      <SEO title={t("Privacy")} url={href("/privacy")} />
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            <span className="mini-square" />
            {t(" PRIVACY")}
          </p>
          <h1 id="privacy">{t("Your browser. Your choices.").toUpperCase()}</h1>
        </div>
      </div>
      <div className="privacy-content">
        <h2>{t("Necessary cookies")}</h2>
        <p>
          {t(
            "Your language is part of the web address. These cookies keep the store working and are always on:",
          )}
        </p>
        <dl>
          {cookies.map((cookie) => (
            <div key={cookie.names[0]}>
              <dt>
                {cookie.names.map((name) => (
                  <code key={name}>{name}</code>
                ))}
              </dt>
              <dd>{t(cookie.purpose)}</dd>
            </div>
          ))}
        </dl>
        <h2>{t("Analytics and marketing")}</h2>
        <p>
          {t(
            "Analytics and marketing tools only load after you accept them in the cookie banner, and your choice is passed on to the checkout. You can change it at any time.",
          )}
        </p>
        <ConsentSettingsButton className="button button-dark" lang={htmlLang} />
        <h2>{t("In this browser")}</h2>
        <p>
          {t(
            "Saved items and the demo newsletter sign-up stay in this browser and are never sent to us.",
          )}
        </p>
        <h2>{t("Payment")}</h2>
        <p>
          {t(
            "Payment happens in Quickbutik’s hosted checkout, so this site never sees your card details.",
          )}
        </p>
      </div>
    </section>
  );
}
