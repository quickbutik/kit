"use client";

import Link from "next/link";
import { SEO } from "@quickbutik/kit/react";
import { usePreferences } from "@/components/store-preferences";
import "@/components/product-details.css";

export default function CategoryNotFound() {
  const { t, href } = usePreferences();
  return (
    <div className="product-not-found">
      {/* Streaming already answered 200: keep this soft 404 out of the index. */}
      <SEO title={t("Not found")} noIndex />
      <p className="eyebrow">404 / SWEATBRAND</p>
      <h1>{t("THIS ONE’S OFF THE RACK.")}</h1>
      <p>
        {t(
          "We couldn’t find that collection. Find your next favorite in the full rotation.",
        )}
      </p>
      <Link className="button button-dark" href={href("/#shop")}>
        {t("EXPLORE ALL ESSENTIALS")}
      </Link>
    </div>
  );
}
