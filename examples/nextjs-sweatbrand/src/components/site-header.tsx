"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useCustomer } from "@quickbutik/kit/react";
import { useEffect, useRef, useState } from "react";
import {
  categoryBySlug,
  categoryPath,
  colorOption,
  departments,
  featuredProducts,
  isDepartment,
  newArrivalsSlug,
  optionValues,
  productPath,
  productsIn,
  filterCategories,
} from "@/lib/catalog";
import { useHydrated } from "@/lib/use-hydrated";
import Icon from "./icons";
import Logo from "./logo";
import ProductPhoto from "./product-photo";
import { usePreferences } from "./store-preferences";
import { useStore } from "./store-context";

type Props = {
  count: number;
  favoritesCount: number;
  onSearch: () => void;
  onBag: () => void;
};

const shopAll: Record<string, string> = {
  "new-arrivals": "All new arrivals",
  women: "All women’s wear",
  men: "All men’s wear",
};

export default function SiteHeader(props: Props) {
  const { price, t, href } = usePreferences();
  const { catalog, signedIn } = useStore();
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const triggers = useRef<Partial<Record<string, HTMLButtonElement | null>>>(
    {},
  );
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardOpen = useRef<string | null>(null);
  const reduceMotion = useReducedMotion();
  const featured = featuredProducts(catalog);
  const hydrated = useHydrated();
  const { isLoggedIn } = useCustomer();
  const loggedIn = hydrated ? isLoggedIn : signedIn;
  const sections = departments.flatMap((department) => {
    const category = categoryBySlug(catalog, department.slug);
    return category ? [{ ...department, category }] : [];
  });

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }
  function closeNavigation() {
    cancelClose();
    keyboardOpen.current = null;
    setOpen(null);
    setMobileOpen(false);
  }
  function action(callback: () => void) {
    closeNavigation();
    callback();
  }
  function panelId(slug: string) {
    return `mega-${slug}`;
  }

  useEffect(() => {
    if (open && keyboardOpen.current === open) {
      header.current
        ?.querySelector<HTMLElement>(`#${panelId(open)} :is(a, button)`)
        ?.focus();
      keyboardOpen.current = null;
    }
  }, [open]);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  useEffect(() => {
    const breakpoint = window.matchMedia("(max-width: 850px)");
    const reset = () => {
      setOpen(null);
      setMobileOpen(false);
    };
    breakpoint.addEventListener("change", reset);
    return () => breakpoint.removeEventListener("change", reset);
  }, []);
  useEffect(() => {
    if (!open && !mobileOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
      keyboardOpen.current = null;
      if (open) {
        setOpen(null);
        triggers.current[open]?.focus();
      } else {
        setMobileOpen(false);
        mobileToggle.current?.focus();
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [open, mobileOpen]);

  // Links into one department, only where the combination has products.
  function link(slug: string, filter: string | undefined, label: string) {
    const category = categoryBySlug(catalog, slug);
    const narrowed = filter ? categoryBySlug(catalog, filter) : undefined;
    if (!category || (filter && !narrowed)) return null;
    if (productsIn(catalog, category, narrowed).length === 0) return null;
    return (
      <Link
        key={`${slug}-${filter}`}
        href={href(categoryPath(slug, filter))}
        onNavigate={closeNavigation}
      >
        {t(label)}
      </Link>
    );
  }

  function panel(section: (typeof sections)[number]) {
    const { slug, category } = section;
    const onlyNew = slug === newArrivalsSlug;
    const product = featured.get(slug);
    const colors = product ? optionValues(product, colorOption) : [];
    return (
      <motion.div
        id={panelId(slug)}
        className="mega-menu"
        role="region"
        aria-label={t("{department} collections", {
          department: t(category.name),
        })}
        initial={reduceMotion ? false : { opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.22 }}
      >
        <div
          className={`mega-menu-inner${product ? "" : " mega-menu-links-only"}`}
        >
          <div className="mega-link-group">
            <h2>
              {onlyNew
                ? t("SHOP THE DROP")
                : t("SHOP {department}", {
                    department: t(category.name).toUpperCase(),
                  })}
            </h2>
            <Link
              className="mega-shop-all"
              href={href(categoryPath(slug))}
              onNavigate={closeNavigation}
            >
              {t(shopAll[slug] ?? "Shop all")} <Icon name="arrow" size={15} />
            </Link>
            {filterCategories(catalog, category)
              .filter((type) => !isDepartment(type))
              .map((type) => link(slug, type.slug, type.name))}
          </div>
          <div className="mega-link-group">
            <h2>{t("THE DAILY EDIT")}</h2>
            {onlyNew ? (
              <>
                {link(slug, "women", "Women’s new arrivals")}
                {link(slug, "men", "Men’s new arrivals")}
                <Link href={href("/#shop")} onNavigate={closeNavigation}>
                  {t("The daily rotation")}
                </Link>
              </>
            ) : (
              <>
                {link(slug, newArrivalsSlug, "New arrivals")}
                {link(slug, "layers", "Off-duty layers")}
                {link(slug, "accessories", "The small essentials")}
              </>
            )}
            <Link href={href("/size-guide")} onNavigate={closeNavigation}>
              {t("Find your fit ")}
              <Icon name="arrow-up" size={12} />
            </Link>
          </div>
          {product && (
            <div className="mega-feature">
              <h2>{t("The daily rotation")}</h2>
              <Link
                href={href(productPath(product))}
                className="mega-product"
                onNavigate={closeNavigation}
              >
                <span className="mega-product-photo">
                  <ProductPhoto
                    product={product}
                    sizes="(max-width: 850px) 0px, (max-width: 1100px) 104px, 148px"
                  />
                </span>
                <span className="mega-product-caption">
                  <strong>{product.name}</strong>
                  {colors.length === 1 && <small>{t(colors[0])}</small>}
                  {product.price !== null && (
                    <span className="mega-product-price">
                      {price(product.price, product.currency)}
                    </span>
                  )}
                  <Icon name="arrow" size={18} />
                </span>
              </Link>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <>
      <header
        ref={header}
        className={`header${pathname === href("/club") ? " header-club" : ""}`}
        onPointerEnter={cancelClose}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") {
            cancelClose();
            closeTimer.current = setTimeout(() => setOpen(null), 220);
          }
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            closeNavigation();
        }}
      >
        <div className="header-inner">
          <button
            ref={mobileToggle}
            className="icon-button mobile-menu-toggle"
            aria-label={t(mobileOpen ? "Close navigation" : "Open navigation")}
            aria-expanded={mobileOpen}
            aria-controls="main-navigation"
            onClick={() => {
              cancelClose();
              setMobileOpen(!mobileOpen);
              setOpen(null);
            }}
          >
            <Icon name={mobileOpen ? "close" : "menu"} />
          </button>
          <Link
            className="wordmark"
            href={href("/")}
            aria-label={t("SWEATBRAND home")}
            onClick={closeNavigation}
          >
            <Logo />
          </Link>
          <nav
            id="main-navigation"
            className={`navigation ${mobileOpen ? "navigation-open" : ""}`}
            aria-label={t("Main navigation")}
          >
            {sections.map((section) => {
              const department = section.slug;
              const current = pathname.startsWith(
                href(categoryPath(department)),
              );
              return (
                <div className="navigation-item" key={department}>
                  <button
                    ref={(element) => {
                      triggers.current[department] = element;
                    }}
                    className={`nav-trigger ${current || open === department ? "nav-active" : ""}`}
                    aria-expanded={open === department}
                    aria-controls={
                      open === department ? panelId(department) : undefined
                    }
                    onPointerEnter={(event) => {
                      if (
                        event.pointerType === "mouse" &&
                        window.matchMedia("(min-width: 851px)").matches
                      ) {
                        cancelClose();
                        setOpen(department);
                      }
                    }}
                    onClick={() => {
                      cancelClose();
                      setOpen(open === department ? null : department);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        cancelClose();
                        if (open === department)
                          header.current
                            ?.querySelector<HTMLElement>(
                              `#${panelId(department)} :is(a, button)`,
                            )
                            ?.focus();
                        else {
                          keyboardOpen.current = department;
                          setOpen(department);
                        }
                      }
                    }}
                  >
                    {t(section.category.name)}
                    {department === newArrivalsSlug && (
                      <span className="nav-dot" />
                    )}
                    <Icon name="chevron" size={11} />
                  </button>
                  {open === department && panel(section)}
                </div>
              );
            })}
            <Link
              className={`nav-club ${pathname === href("/club") ? "nav-active" : ""}`}
              href={href("/club")}
              aria-current={pathname === href("/club") ? "page" : undefined}
              onNavigate={closeNavigation}
            >
              {t("The everyday club ")}
              <Icon name="arrow-up" size={13} />
            </Link>
          </nav>
          <div className="header-actions">
            <button
              className="icon-button"
              aria-label={t("Search products")}
              onClick={() => action(props.onSearch)}
            >
              <Icon name="search" size={21} />
            </button>
            {catalog.accounts.login.enabled && (
              <Link
                className={`icon-button account-button ${loggedIn ? "is-logged-in" : ""}`}
                href={href("/account")}
                aria-label={t(loggedIn ? "Your account" : "Log in")}
                onNavigate={closeNavigation}
              >
                <Icon name="user" size={21} />
              </Link>
            )}
            <Link
              className={`icon-button favorites-button ${pathname === href("/saved") ? "is-saved" : ""}`}
              href={href("/saved")}
              aria-label={t("View {count} saved items", {
                count: props.favoritesCount,
              })}
              onNavigate={closeNavigation}
            >
              <Icon name="heart" size={21} />
              {props.favoritesCount > 0 && (
                <span className="small-count">{props.favoritesCount}</span>
              )}
            </Link>
            <button
              className="bag-button"
              aria-label={t("Open shopping bag, {count} items", {
                count: props.count,
              })}
              onClick={() => action(props.onBag)}
            >
              <Icon name="bag" size={21} />
              <span className="bag-label">{t("Bag")}</span>
              <span className="bag-count">{props.count}</span>
            </button>
          </div>
        </div>
      </header>
      {(open || mobileOpen) && (
        <button
          className="mega-backdrop"
          aria-label={t("Close navigation menu")}
          tabIndex={-1}
          onClick={closeNavigation}
        />
      )}
    </>
  );
}
