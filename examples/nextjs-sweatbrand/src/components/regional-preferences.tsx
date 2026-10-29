"use client";

import { useState } from "react";
import { describeCurrency } from "@quickbutik/kit";
import { languages, type Language } from "@/lib/localization";
import Flag from "./flag";
import Icon from "./icons";
import { useStore } from "./store-context";
import { usePreferences } from "./store-preferences";

export default function RegionalPreferences({
  onClose,
}: {
  onClose: () => void;
}) {
  const { language, currency, setPreferences, t, htmlLang } = usePreferences();
  const { catalog } = useStore();
  const [draft, setDraft] = useState<Language>(language);
  const [draftCurrency, setDraftCurrency] = useState(currency);
  // Only what the shop offers in its admin; just its own currency when the
  // currency converter is off.
  const chosen = describeCurrency(catalog.shop, draftCurrency);
  const choosesCurrency = chosen.currencies.length > 1;
  const currencyNames = new Intl.DisplayNames([htmlLang], { type: "currency" });
  function currencyName(code: string) {
    const name = currencyNames.of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(htmlLang) + name.slice(1);
  }
  // "kr", "€", "zł": the short sign shoppers know, not the ISO code.
  function currencySymbol(code: string) {
    return (
      new Intl.NumberFormat(htmlLang, {
        style: "currency",
        currency: code,
        currencyDisplay: "narrowSymbol",
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? code
    );
  }
  return (
    <form
      className="region-form"
      onSubmit={(event) => {
        event.preventDefault();
        setPreferences({ language: draft, currency: draftCurrency });
        onClose();
      }}
    >
      <div className="region-heading">
        <span className="region-globe">
          <Icon name="globe" size={26} />
        </span>
        <h2>{t("YOUR STORE. YOUR WAY.")}</h2>
        <p>
          {t(
            choosesCurrency
              ? "Choose your language and currency."
              : "Choose your language.",
          )}
        </p>
      </div>
      <fieldset>
        <legend>{t("Language")}</legend>
        <div className="region-options">
          {languages.map((item) => (
            <label className="region-option" key={item.code}>
              <input
                className="sr-only"
                type="radio"
                name="language"
                value={item.code}
                checked={draft === item.code}
                onChange={() => setDraft(item.code)}
              />
              <span className="region-mark">
                <Flag language={item.code} />
              </span>
              <span className="region-label">
                <strong lang={item.htmlLang}>{item.name}</strong>
                <small>{item.code.toUpperCase()}</small>
              </span>
              <span className="region-selection">
                <Icon name="check" size={14} />
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {choosesCurrency && (
        <fieldset>
          <legend>{t("Currency")}</legend>
          <div className="region-options">
            {chosen.currencies.map((item) => (
              <label className="region-option" key={item.code}>
                <input
                  className="sr-only"
                  type="radio"
                  name="currency"
                  value={item.code}
                  checked={chosen.currency === item.code}
                  onChange={() => setDraftCurrency(item.code)}
                />
                <span className="region-mark region-symbol" aria-hidden="true">
                  {currencySymbol(item.code)}
                </span>
                <span className="region-label">
                  <strong>{currencyName(item.code)}</strong>
                  <small>{item.code}</small>
                </span>
                <span className="region-selection">
                  <Icon name="check" size={14} />
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {!choosesCurrency ? (
        <p className="region-currency-note">
          {t("Prices are shown in {currency}.", { currency })}
        </p>
      ) : (
        chosen.mode === "display" && (
          <p className="region-currency-note">
            {t(
              "Prices in {currency} are converted. You pay in {chargeCurrency} at checkout.",
              {
                currency: chosen.currency!,
                chargeCurrency: chosen.chargeCurrency!,
              },
            )}
          </p>
        )
      )}
      <div className="region-actions">
        <button className="button button-dark" type="submit">
          {t("APPLY PREFERENCES")} <Icon name="arrow" size={18} />
        </button>
        <button className="continue-button" type="button" onClick={onClose}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}
