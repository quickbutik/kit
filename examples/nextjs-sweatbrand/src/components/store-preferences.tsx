"use client";

import { createContext, useContext, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { describeCurrency, type Shop } from "@quickbutik/kit";
import { useClientCurrency, useShopkit } from "@quickbutik/kit/react";
import {
  formatPrice,
  languages,
  localePath,
  translate,
  type Language,
} from "@/lib/localization";

const PreferencesContext = createContext<{
  language: Language;
  // What prices are shown in: the shopper's choice when the shop offers it.
  currency: string;
  setPreferences: (next: { language: Language; currency: string }) => void;
  // Format with the currency the API states for the amount; the shop's own
  // currency when it states none.
  price: (amount: number, currency?: string | null) => string;
  t: (text: string, values?: Record<string, string | number>) => string;
  href: (path: string) => string;
  htmlLang: string;
} | null>(null);

export function PreferencesProvider({
  children,
  language,
  shop,
}: {
  children: ReactNode;
  language: Language;
  shop: Pick<Shop, "currencies"> & { currency: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const shopkit = useShopkit();
  // The server snapshot is the currency the page was rendered in, so the
  // first paint matches; a switch shows here before the catalog refetches.
  const selected = useClientCurrency(shopkit);
  const currency = describeCurrency(shop, selected).currency ?? shop.currency;

  async function setPreferences(next: {
    language: Language;
    currency: string;
  }) {
    // Always a code, never null: null returns to the currency the provider
    // mounted with, which is not necessarily the shop's own.
    if (next.currency !== currency) await shopkit.setCurrency(next.currency);
    if (next.language !== language) {
      const path = pathname.replace(/^\/[^/]+/, "") || "/";
      router.replace(
        localePath(next.language, path) + location.search + location.hash,
        { scroll: false },
      );
    } else if (next.currency !== currency) {
      // Server components read the catalog again in the new currency.
      router.refresh();
    }
  }
  return (
    <PreferencesContext.Provider
      value={{
        language,
        currency,
        setPreferences: (next) => void setPreferences(next),
        price: (amount, amountCurrency) =>
          formatPrice(amount, amountCurrency ?? shop.currency, language),
        t: (text, values) => translate(text, language, values),
        href: (path) => localePath(language, path),
        htmlLang: languages.find((item) => item.code === language)!.htmlLang,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context)
    throw new Error("Store preferences require PreferencesProvider.");
  return context;
}
