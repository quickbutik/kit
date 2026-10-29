"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { SEO, useCustomer, useCustomerClub } from "@quickbutik/kit/react";
import { categoryPath, productTypes } from "@/lib/catalog";
import { useHydrated } from "@/lib/use-hydrated";
import Icon from "./icons";
import ProductListing from "./product-listing";
import SplitHero from "./split-hero";
import { usePreferences } from "./store-preferences";
import { useStore } from "./store-context";

export default function HomeStorefront() {
  const router = useRouter();
  const { t, href } = usePreferences();
  const { catalog } = useStore();
  return (
    <>
      <SEO
        title={`SWEATBRAND — ${t("Built to move. Made for everyday.")}`}
        titleTemplate="%s"
        description={t(
          "Workout wear with a street state of mind. Discover the daily rotation: training essentials, everyday layers, and off-duty favorites.",
        )}
        url={href("/")}
      />
      <SplitHero
        onShop={(side) => router.push(href(categoryPath(side.toLowerCase())))}
      />

      <div className="brand-strip" aria-label={t("The SWEATBRAND way")}>
        <span>
          <Icon name="spark" size={19} />
          {t(" PERFORMANCE MEETS EVERYDAY")}
        </span>
        <span>
          <Icon name="spark" size={19} />
          {t(" FOR THE WORK. FOR THE WEEKEND.")}
        </span>
        <span>
          <Icon name="spark" size={19} />
          {t(" ALL PACES. ALL PLACES.")}
        </span>
      </div>

      <section
        className="shop-section"
        id="shop"
        aria-labelledby="shop-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              <span className="mini-square" />
              {t(" THE GOOD STUFF")}
            </p>
            <h2 id="shop-heading">
              {t("YOUR DAILY ROTATION")}
              <span className="heading-period">.</span>
            </h2>
          </div>
          <p>
            {t("Gym hours. Street hours. All the hours in between.")}
            <br />
            {t("Meet your new everyday essentials.")}
          </p>
        </div>
        <ProductListing
          products={catalog.products}
          tabs={[
            { label: t("All essentials"), href: "/#shop", active: true },
            ...productTypes(catalog).map((category) => ({
              label: t(category.name),
              href: categoryPath(category.slug),
              active: false,
            })),
          ]}
          empty={{
            icon: "search",
            title: t("No fits found. Yet."),
            text: t("New pieces are on their way. Check back soon."),
          }}
        />
        <div className="collection-bottom">
          <span>{t("THE WHOLE ROTATION. NO WRONG TURNS.")}</span>
          <a href="#shop">
            {t("BACK TO THE TOP ")}
            <Icon name="arrow-up" size={14} />
          </a>
        </div>
      </section>

      <section
        className="everyday-section"
        id="club"
        aria-labelledby="club-heading"
      >
        <div className="club-art">
          <span className="club-art-label eyebrow">
            {t("NOT JUST A WORKOUT. A WAY OF LIFE.")}
          </span>
          <div className="club-type">
            {t("THE")}
            <br />
            <span>{t("EVERYDAY")}</span>
            <br />
            {t("CLUB")}
          </div>
          <div className="club-art-bottom">
            <span>{t("ALL PACES WELCOME.")}</span>
            <Icon name="arrow-up" size={40} />
          </div>
        </div>
        <div className="club-copy">
          <p className="eyebrow">{t("GOOD PEOPLE. GOOD MOVEMENT.")}</p>
          <h2 id="club-heading">
            {t("YOU DON’T HAVE TO")}
            <br />
            {t("GO PRO. JUST GO.")}
          </h2>
          <p>
            {t("Early risers. Late movers. One-more-reppers.")}
            <br />
            {t("Take-the-long-way-homers.")}
          </p>
          <p>
            {t(
              "We’re here for the everyday athletes. The ones who show up, move a little, and make it their own. Good gear for whatever your kind of movement looks like.",
            )}
          </p>
          <ClubStatus />
          <Link className="text-link" href={href("/history")}>
            {t("GET TO KNOW SWEATBRAND ")}
            <Icon name="arrow" size={18} />
          </Link>
        </div>
      </section>
    </>
  );
}

// The Quickbutik customer club behind the Everyday Club, once accounts are on.
function ClubStatus() {
  const { t, href } = usePreferences();
  const { catalog } = useStore();
  const hydrated = useHydrated();
  const { isLoggedIn } = useCustomer();
  const { data: club } = useCustomerClub();
  const { login, customerClub } = catalog.accounts;
  if (!login.enabled || !customerClub.enabled) return null;
  if (hydrated && isLoggedIn && club?.member)
    return (
      <Link className="text-link club-status" href={href("/club")}>
        <span>
          {t(club.points.balance === 1 ? "1 POINT" : "{balance} POINTS", {
            balance: club.points.balance,
          })}
          {club.reward.targetPoints > 0 &&
            ` · ${t(
              club.reward.remaining === 1
                ? "1 POINT TO YOUR NEXT REWARD"
                : "{remaining} TO YOUR NEXT REWARD",
              { remaining: club.reward.remaining },
            )}`}
        </span>
        <Icon name="arrow" size={18} />
      </Link>
    );
  const member = hydrated && isLoggedIn;
  return (
    <Link className="text-link club-status" href={href("/club")}>
      {t(member ? "YOUR CLUB ACCOUNT " : "DISCOVER THE CLUB ")}
      <Icon name="arrow" size={18} />
    </Link>
  );
}
