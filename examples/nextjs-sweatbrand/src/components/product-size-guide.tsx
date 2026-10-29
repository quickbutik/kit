"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "./icons";
import {
  bodySizes,
  measurementRange,
  sockSizes,
  type MeasurementUnit,
} from "@/lib/size-guide";
import { usePreferences } from "./store-preferences";

export default function ProductSizeGuide({
  name,
  sizes,
  onNavigate,
}: {
  name: string;
  sizes: string[];
  onNavigate: () => void;
}) {
  const { t, href } = usePreferences();
  const [unit, setUnit] = useState<MeasurementUnit>("cm");
  return (
    <div className="product-size-guide">
      <p className="eyebrow">{name}</p>
      <h2>{t("FIND YOUR EVERYDAY FIT.")}</h2>
      {sizes.every((size) => /^one size$/i.test(size)) ? (
        <p>{t("One adjustable size. Use the back strap to find your fit.")}</p>
      ) : sizes.includes("S/M") ? (
        <table>
          <caption>{t("EU shoe size")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("Size")}</th>
              <th scope="col">{t("EU shoe size")}</th>
            </tr>
          </thead>
          <tbody>
            {sockSizes.map((row) => (
              <tr key={row.size}>
                <th scope="row">{row.size}</th>
                <td>{row.eu}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div
            className="product-size-units"
            role="group"
            aria-label={t("Measurement units")}
          >
            <button
              className="category-tab"
              aria-pressed={unit === "cm"}
              onClick={() => setUnit("cm")}
            >
              {t("Centimeters")}
            </button>
            <button
              className="category-tab"
              aria-pressed={unit === "in"}
              onClick={() => setUnit("in")}
            >
              {t("Inches")}
            </button>
          </div>
          <div className="product-size-table">
            <table>
              <caption>
                {t(
                  "General demo body measurements. Use the product’s fit notes to choose your size.",
                )}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t("Size")}</th>
                  <th scope="col">
                    {t("Chest")} ({unit})
                  </th>
                  <th scope="col">
                    {t("Waist")} ({unit})
                  </th>
                  <th scope="col">
                    {t("Hips")} ({unit})
                  </th>
                </tr>
              </thead>
              <tbody>
                {bodySizes.map((row) => (
                  <tr key={row.size}>
                    <th scope="row">{row.size}</th>
                    <td>{measurementRange(row.chest, unit)}</td>
                    <td>{measurementRange(row.waist, unit)}</td>
                    <td>{measurementRange(row.hips, unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            {t(
              "Measure around the fullest part of your chest and hips, and the narrowest part of your waist.",
            )}
          </p>
          <p>
            {t(
              "Choose your usual size. Between sizes? Size up for a roomier fit.",
            )}
          </p>
        </>
      )}
      <Link
        className="product-full-size-guide"
        href={href("/size-guide")}
        onNavigate={onNavigate}
      >
        {t("VIEW THE FULL SIZE GUIDE")}
        <Icon name="arrow" size={16} />
      </Link>
    </div>
  );
}
