"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Drawer } from "vaul";
import {
  useState,
  useRef,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Cart, ConsentState, ShopkitConfig } from "@quickbutik/kit";
import {
  ConsentSettingsButton,
  SeoProvider,
  ShopkitProvider,
  useCart,
  useProductSearch,
} from "@quickbutik/kit/react";
import {
  categoryPath,
  colorOption,
  optionValues,
  productPath,
  type Catalog,
} from "@/lib/catalog";
import Icon from "./icons";
import Logo from "./logo";
import Modal from "./modal";
import ProductPhoto from "./product-photo";
import BagContents from "./bag";
import { StoreContext } from "./store-context";
import SiteHeader from "./site-header";
import StoreThemeTransition from "./store-theme-transition";
import { languages, localePath, type Language } from "@/lib/localization";
import RegionalPreferences from "./regional-preferences";
import { PreferencesProvider, usePreferences } from "./store-preferences";
import "./storefront.css";

type Panel = "bag" | "search" | "info" | "region" | null;
const memoryStorage = new Map<string, string>();

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("sweatbrand:storage", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("sweatbrand:storage", callback);
  };
}
function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key) ?? memoryStorage.get(key) ?? "[]";
  } catch {
    return memoryStorage.get(key) ?? "[]";
  }
}
function useSavedList<T>(
  key: string,
  valid: (item: unknown) => item is T,
): [T[], (items: T[]) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readStorage(key),
    () => "[]",
  );
  let value: T[] = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) value = parsed.filter(valid);
  } catch {
    /* A malformed saved value starts with an empty list. */
  }
  return [
    value,
    (items: T[]) => {
      const serialized = JSON.stringify(items);
      memoryStorage.set(key, serialized);
      try {
        window.localStorage.setItem(key, serialized);
      } catch {
        /* Session storage remains usable. */
      }
      window.dispatchEvent(new Event("sweatbrand:storage"));
    },
  ];
}

const infoContent: Record<string, { title: string; text: string }> = {
  "Shipping & returns": {
    title: "Easy from the start.",
    text: "Shipping options and prices are shown in the checkout before you pay. Returns are available within 30 days in unworn condition.",
  },
  Contact: {
    title: "Let’s talk.",
    text: "SWEATBRAND is a concept store. Your bag and checkout run on Quickbutik, and your order confirmation arrives by email with the details of your order.",
  },
};

export default function Storefront({
  language,
  catalog,
  config,
  currency,
  initialCart,
  consent,
  signedIn,
  siteUrl,
  children,
}: {
  language: Language;
  catalog: Catalog;
  config: ShopkitConfig;
  // The currency the server priced the page in; null for the shop's own.
  currency: string | null;
  initialCart: Cart | null;
  consent: ConsentState;
  signedIn: boolean;
  siteUrl: string;
  children: ReactNode;
}) {
  const { locale, htmlLang } = languages.find(
    (item) => item.code === language,
  )!;
  return (
    <ShopkitProvider
      config={config}
      // Undefined, not null, for the shop's own currency: a change to null
      // would make the kit forget the shopper's choice.
      currency={currency ?? undefined}
      initialCart={initialCart}
      // The kit's cookie banner: nothing optional loads before the shopper
      // agrees, and the decision is forwarded to the hosted checkout.
      consent={{
        initialState: consent,
        lang: htmlLang,
        privacyPolicyUrl: localePath(language, "/privacy"),
      }}
    >
      <SeoProvider
        baseUrl={siteUrl}
        shop={catalog.shop}
        siteName="SWEATBRAND"
        titleTemplate="%s | SWEATBRAND"
        locale={locale.replace("-", "_")}
        productPath={`/${locale}/products/{slug}`}
        categoryPath={`/${locale}/category/{slug}`}
        organization
      >
        <PreferencesProvider language={language} shop={catalog.shop}>
          <StoreThemeTransition />
          <StorefrontContent catalog={catalog} signedIn={signedIn}>
            {children}
          </StorefrontContent>
        </PreferencesProvider>
      </SeoProvider>
    </ShopkitProvider>
  );
}

function StorefrontContent({
  catalog,
  signedIn,
  children,
}: {
  catalog: Catalog;
  signedIn: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const drawerNavigation = useRef(false);
  const { language, currency, price, t, href, htmlLang } = usePreferences();
  const { itemCount } = useCart();
  const [panel, setPanel] = useState<Panel>(null);
  const [info, setInfo] = useState("Shipping & returns");
  const [query, setQuery] = useState("");
  const [newsletter, setNewsletter] = useState("");
  const [newsletterDone, setNewsletterDone] = useState(false);
  const [favorites, setFavorites] = useSavedList<string>(
    "sweatbrand-favorites",
    (item): item is string =>
      typeof item === "string" &&
      catalog.products.some((product) => product.id === item),
  );
  const searchTerm = query.trim();
  const search = useProductSearch(
    { search: searchTerm, limit: 24 },
    { enabled: searchTerm.length > 0 },
  );
  const results = searchTerm ? (search.data?.data ?? []) : catalog.products;

  function goToCollection() {
    if (pathname !== href("/")) router.push(href("/#shop"));
    else
      document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" });
  }
  function toggleFavorite(id: string) {
    setFavorites(
      favorites.includes(id)
        ? favorites.filter((favorite) => favorite !== id)
        : [...favorites, id],
    );
  }
  function closeDrawerForNavigation() {
    drawerNavigation.current = true;
    setPanel(null);
  }
  function openInfo(key: string) {
    setInfo(key);
    setPanel("info");
  }
  function submitNewsletter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      window.localStorage.setItem("sweatbrand-newsletter", newsletter);
    } catch {
      /* The confirmation also works without storage. */
    }
    setNewsletterDone(true);
  }
  const regionLabel = t("Language and currency: {language}, {currency}", {
    language: language.toUpperCase(),
    currency,
  });

  return (
    <StoreContext.Provider
      value={{
        catalog,
        signedIn,
        favorites,
        toggleFavorite,
        openBag: () => setPanel("bag"),
        openInfo,
      }}
    >
      <a className="skip-link" href="#main-content">
        {t("Skip to products")}
      </a>
      <div
        className={`announcement${pathname === href("/club") ? " club-announcement" : ""}`}
      >
        <div className="announcement-inner">
          <span>{t("GOOD GEAR. GOOD ENERGY.")}</span>
          <span>
            {t("SHIPPING CALCULATED AT CHECKOUT")}{" "}
            <Icon name="arrow" size={14} />
          </span>
          <button
            className="region-trigger"
            onClick={() => setPanel("region")}
            aria-label={regionLabel}
            aria-haspopup="dialog"
          >
            <Icon name="globe" size={13} /> {language.toUpperCase()} /{" "}
            {currency} <Icon name="chevron" size={10} />
          </button>
        </div>
      </div>
      <SiteHeader
        count={itemCount}
        favoritesCount={favorites.length}
        onSearch={() => setPanel("search")}
        onBag={() => setPanel("bag")}
      />

      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <section
        className={`benefits${pathname === href("/club") ? " club-shopping-benefits" : ""}`}
        aria-label={t("Shopping benefits")}
      >
        <div>
          <Icon name="truck" size={25} />
          <div>
            <h3>{t("Good things, delivered.")}</h3>
            <p>{t("Choose your shipping at checkout")}</p>
          </div>
        </div>
        <div>
          <Icon name="return" size={25} />
          <div>
            <h3>{t("Find your fit. No pressure.")}</h3>
            <p>{t("Easy returns within 30 days")}</p>
          </div>
        </div>
        <div>
          <Icon name="spark" size={25} />
          <div>
            <h3>{t("Made for your everyday.")}</h3>
            <p>{t("From the warm-up to the wind-down")}</p>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-main">
          <div className="newsletter">
            <p className="eyebrow">{t("NEWSLETTER")}</p>
            <h2>
              {t("A LITTLE GOOD")}
              <br />
              {t("IN YOUR INBOX.")}
            </h2>
            <p>
              {t(
                "Fresh drops. Everyday inspiration. The occasional nudge to move.",
              )}
            </p>
            {newsletterDone ? (
              <div className="newsletter-success" role="status">
                <Icon name="check" />
                <span>
                  {t("You’re on the demo list. Good energy incoming.")}
                </span>
              </div>
            ) : (
              <form onSubmit={submitNewsletter}>
                <label htmlFor="newsletter-email">{t("Email address")}</label>
                <div className="newsletter-fields">
                  <input
                    id="newsletter-email"
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                    value={newsletter}
                    onChange={(event) => setNewsletter(event.target.value)}
                    aria-describedby="newsletter-note"
                    required
                    autoComplete="email"
                  />
                  <button type="submit">
                    {t("Sign up")}
                    <Icon name="arrow" size={16} />
                  </button>
                </div>
              </form>
            )}
            <span className="newsletter-note" id="newsletter-note">
              {t("A demo sign-up, saved in this browser.")}
            </span>
          </div>
          <div className="footer-links">
            <div>
              <h3>{t("THE ROTATION")}</h3>
              <Link href={href(categoryPath("new-arrivals"))}>
                {t("New arrivals")}
              </Link>
              <Link href={href(categoryPath("women"))}>{t("Women")}</Link>
              <Link href={href(categoryPath("men"))}>{t("Men")}</Link>
              <Link href={href(categoryPath("accessories"))}>
                {t("The small essentials")}
              </Link>
            </div>
            <div>
              <h3>{t("HERE TO HELP")}</h3>
              {[
                "Shipping & returns",
                "Size guide",
                "Care guide",
                "Contact",
              ].map((key) =>
                key === "Size guide" || key === "Care guide" ? (
                  <Link
                    key={key}
                    href={href(
                      key === "Size guide" ? "/size-guide" : "/washing-guide",
                    )}
                  >
                    {t(key)}
                  </Link>
                ) : (
                  <button key={key} onClick={() => openInfo(key)}>
                    {t(key)}
                  </button>
                ),
              )}
            </div>
            <div>
              <h3>{t("THE SWEATBRAND WAY")}</h3>
              <Link href={href("/history")}>{t("Our story")}</Link>
              <Link href={href("/club")}>{t("The everyday club")}</Link>
              <Link href={href("/privacy")}>{t("Privacy")}</Link>
              <ConsentSettingsButton lang={htmlLang} />
            </div>
          </div>
        </div>
        <div className="footer-wordmark" aria-hidden="true">
          <Logo />
        </div>
        <div className="footer-bottom">
          <span>{t("© 2026 SWEATBRAND. ALL PACES WELCOME.")}</span>
          <span>{t("CONCEPT STORE · DEMO PRODUCTS & CHECKOUT")}</span>
          <button
            className="region-trigger footer-region-picker"
            onClick={() => setPanel("region")}
            aria-label={regionLabel}
            aria-haspopup="dialog"
          >
            <Icon name="globe" size={15} /> {language.toUpperCase()} /{" "}
            {currency} <Icon name="chevron" size={12} />
          </button>
        </div>
      </footer>

      {panel === "region" && (
        <Modal label={t("Language & currency")} onClose={() => setPanel(null)}>
          <RegionalPreferences onClose={() => setPanel(null)} />
        </Modal>
      )}

      <Drawer.Root
        open={panel === "bag"}
        direction="right"
        autoFocus
        onOpenChange={(open) =>
          setPanel((current) =>
            open ? "bag" : current === "bag" ? null : current,
          )
        }
      >
        <Drawer.Portal>
          <Drawer.Overlay className="drawer-overlay" />
          <Drawer.Content
            className="drawer"
            aria-modal="true"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              // Navigation and other dialogs manage their own focus.
              if (panel === null && !drawerNavigation.current) {
                document
                  .querySelector<HTMLButtonElement>(".bag-button")
                  ?.focus({ preventScroll: true });
              }
              drawerNavigation.current = false;
            }}
          >
            <div className="modal-top">
              <Drawer.Title asChild>
                <span className="eyebrow">
                  {t("YOUR BAG")} / {itemCount}{" "}
                  {t(itemCount === 1 ? "ITEM" : "ITEMS")}
                </span>
              </Drawer.Title>
              <Drawer.Close asChild>
                <button className="icon-button" aria-label={t("Close dialog")}>
                  <Icon name="close" />
                </button>
              </Drawer.Close>
            </div>
            <Drawer.Description className="sr-only">
              {t("Review your items and continue to checkout.")}
            </Drawer.Description>
            <BagContents onNavigate={closeDrawerForNavigation} />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {panel === "search" && (
        <Modal
          label={t("FIND YOUR NEXT FAVORITE")}
          onClose={() => setPanel(null)}
        >
          <form
            className="search-form"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              setPanel(null);
              if (searchTerm)
                router.push(
                  href(`/search?q=${encodeURIComponent(searchTerm)}`),
                );
              else goToCollection();
            }}
          >
            <label htmlFor="product-search">
              {t("What are you looking for?")}
            </label>
            <div className="search-input">
              <Icon name="search" />
              <input
                id="product-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("Try tees, hoodies, or sage…")}
              />
              <button type="submit" aria-label={t("See search results")}>
                <Icon name="arrow" />
              </button>
            </div>
          </form>
          <div className="search-results" aria-busy={search.loading}>
            <span className="eyebrow">
              {results.length}
              {searchTerm && search.data?.has_more ? "+" : ""}
              {t(" MATCHING ESSENTIALS")}
            </span>
            {results.slice(0, 4).map((product) => (
              <Link
                href={href(productPath(product))}
                className="search-result"
                key={product.id}
                onNavigate={() => setPanel(null)}
              >
                <div className="search-result-photo">
                  <ProductPhoto product={product} sizes="70px" />
                </div>
                <span>
                  {product.name}
                  <small>
                    {optionValues(product, colorOption)
                      .map((color) => t(color))
                      .join(", ")}
                  </small>
                </span>
                <span>
                  {product.price !== null
                    ? price(product.price, product.currency)
                    : ""}
                </span>
                <Icon name="arrow-up" size={16} />
              </Link>
            ))}
            {searchTerm && !search.loading && results.length === 0 && (
              <p>{t("No results yet. Try “tee” or “shorts”.")}</p>
            )}
          </div>
        </Modal>
      )}

      {panel === "info" && (
        <Modal label={t(info).toUpperCase()} onClose={() => setPanel(null)}>
          <div className="info-content">
            <h2>{t(infoContent[info].title)}</h2>
            <p>{t(infoContent[info].text)}</p>
            <button
              className="button button-dark"
              onClick={() => setPanel(null)}
            >
              {t("GOT IT ")}
              <Icon name="check" />
            </button>
          </div>
        </Modal>
      )}
    </StoreContext.Provider>
  );
}
