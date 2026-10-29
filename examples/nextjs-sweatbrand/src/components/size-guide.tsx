"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { SEO } from "@quickbutik/kit/react";
import {
  bodySizes,
  measurementRange,
  sockSizes,
  type MeasurementUnit,
} from "@/lib/size-guide";
import Icon from "./icons";
import { usePreferences } from "./store-preferences";
import "./size-guide.css";

const categories = ["Clothing", "Socks", "Caps"] as const;

// Measurement method and fit explanations informed by:
// https://www.nike.com/size-fit/mens_tops_alpha
// https://www.patagonia.com/guides/size-fit/mens/
// Size values belong to this demo collection; they are not those brands' charts.
const measurements = [
  {
    name: "Chest",
    text: "Wrap the tape around the fullest part of your chest, under your arms. Keep your arms relaxed.",
  },
  {
    name: "Waist",
    text: "Find your natural waist by bending gently to one side. Measure around that crease, without holding your breath.",
  },
  {
    name: "Hips",
    text: "Stand with your feet together and measure around the widest part of your hips and seat.",
  },
] as const;

const fits = [
  {
    name: "Fitted",
    label: "CLOSE TO YOU",
    text: "A close, body-following shape. Think Sculpt styles, with less room between you and the fabric.",
    shape: "fitted",
  },
  {
    name: "Relaxed",
    label: "ROOM TO MOVE",
    text: "An easy shape with a little extra space. Choose your usual size for the intended laid-back fit.",
    shape: "relaxed",
  },
  {
    name: "Oversized",
    label: "A LITTLE EXTRA",
    text: "A deliberately roomier silhouette. Your usual size already gives you that oversized look.",
    shape: "oversized",
  },
] as const;

const questions = [
  {
    question: "What if I’m between sizes?",
    answer:
      "Choose the larger size if you prefer more room. For tops, start with your chest measurement; for bottoms, check both your waist and hips and allow room for the larger measurement.",
  },
  {
    question: "Are these body or garment measurements?",
    answer:
      "These are general body measurements for our demo collection, not the dimensions of a finished garment. Different fabrics and cuts fit differently, so always read the fit notes on the product page.",
  },
  {
    question: "Should I size down in oversized pieces?",
    answer:
      "Start with your usual size. An oversized cut already includes extra room. Only size down if you want a closer fit, and check the product’s fit notes first.",
  },
  {
    question: "How do I choose a sports bra size?",
    answer:
      "Use the chest measurement as a starting point for our alpha-sized Sculpt Bra. This general chart does not convert cup or band sizes. Read the product’s fit notes for its intended support and feel.",
  },
] as const;

function MeasuringFigure() {
  return (
    <svg
      viewBox="0 0 300 330"
      fill="none"
      aria-hidden="true"
      className="sg-figure"
    >
      <path
        d="M150 22v286M44 109h212M44 161h212M44 209h212"
        className="sg-figure-grid"
      />
      <circle cx="150" cy="44" r="23" className="sg-figure-body" />
      <path
        d="M136 66v13l-36 12c-9 3-14 10-17 21l-21 87c-3 12 10 16 14 5l24-69 6 45-9 43 13 82h24l16-72 16 72h24l13-82-9-43 6-45 24 69c4 11 17 7 14-5l-21-87c-3-11-8-18-17-21l-36-12V66"
        className="sg-figure-body"
      />
      <path
        d="M106 110q44-11 88 0M106 110q44 13 88 0M106 164q44-9 88 0M106 164q44 11 88 0M99 210q51-12 102 0M99 210q51 14 102 0"
        className="sg-figure-tape"
      />
      {[
        { y: 110, x: 194 },
        { y: 164, x: 194 },
        { y: 210, x: 201 },
      ].map(({ y, x }, index) => (
        <g key={y}>
          <path d={`M${x} ${y}h36`} className="sg-figure-leader" />
          <circle cx="244" cy={y} r="13" className="sg-figure-marker" />
          <text x="244" y={y + 4} textAnchor="middle">
            {index + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

function FitDrawing({ shape }: { shape: (typeof fits)[number]["shape"] }) {
  const outlines = {
    fitted:
      "M83 29 56 40 32 76 53 91 67 72 72 112 64 161h112l-8-49 5-40 14 19 21-15-24-36-27-11",
    relaxed:
      "M83 29 50 42 24 82 53 100 64 80v81h112V80l11 20 29-18-26-40-33-13",
    oversized: "M83 29 38 42 12 91l37 21 9-18v78h124V94l9 18 37-21-26-49-45-13",
  };
  return (
    <svg viewBox="0 0 240 195" fill="none" aria-hidden="true">
      <path d="M120 17v167M42 166h156" className="sg-fit-grid" />
      <path d={outlines[shape]} className="sg-fit-outline" />
      <path
        d="M83 29c5 28 69 28 74 0M89 27c5 20 57 20 62 0"
        className="sg-fit-seam"
      />
      <path
        d={
          shape === "oversized"
            ? "M58 161h124M40 77l34 20M200 77l-34 20"
            : shape === "relaxed"
              ? "M64 151h112M31 72l29 18M209 72l-29 18"
              : "M66 151h108M38 67l21 16M202 67l-21 16"
        }
        className="sg-fit-seam"
      />
    </svg>
  );
}

export default function SizeGuide() {
  const { t, href } = usePreferences();
  const [category, setCategory] =
    useState<(typeof categories)[number]>("Clothing");
  const [unit, setUnit] = useState<MeasurementUnit>("cm");

  return (
    <div className="size-guide-page">
      <SEO
        title={t("Size guide")}
        description={t(
          "Find your everyday fit with body measurement charts, a measuring guide and advice on fitted, relaxed and oversized styles.",
        )}
        url={href("/size-guide")}
      />
      <nav className="sg-breadcrumbs" aria-label={t("Breadcrumbs")}>
        <Link href={href("/")}>{t("Home")}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{t("Size guide")}</span>
      </nav>

      <header className="sg-hero">
        <div className="sg-hero-copy">
          <p className="eyebrow">
            <span className="mini-square" /> {t("THE SIZE & FIT GUIDE")}
          </p>
          <h1>
            {t("FIND YOUR")}
            <br />
            {t("EVERYDAY FIT.")}
          </h1>
          <p className="sg-intro">
            {t(
              "Less guesswork. More good movement. A few simple measurements to help you feel at home in your next favorite.",
            )}
          </p>
          <a href="#size-chart" className="sg-text-link">
            {t("FIND MY SIZE")}
            <Icon name="arrow" size={18} />
          </a>
        </div>
        <div className="sg-hero-image">
          <Image
            src="/images/hero-women-gym.webp"
            alt={t("Relaxed training wear in motion")}
            fill
            sizes="(max-width: 700px) 100vw, 42vw"
            priority
          />
          <div className="sg-ruler" aria-hidden="true" />
          <span className="sg-image-label eyebrow">
            {t("YOUR MOVEMENT. YOUR FIT.")}
          </span>
          <span className="sg-image-index" aria-hidden="true">
            SS / 01
          </span>
        </div>
      </header>

      <nav className="sg-jump-nav" aria-label={t("In this guide")}>
        <a href="#size-chart">
          <span>01</span>
          {t("Size charts")}
          <Icon name="arrow" size={15} />
        </a>
        <a href="#how-to-measure">
          <span>02</span>
          {t("How to measure")}
          <Icon name="arrow" size={15} />
        </a>
        <a href="#find-your-fit">
          <span>03</span>
          {t("Choose your fit")}
          <Icon name="arrow" size={15} />
        </a>
      </nav>

      <section
        className="sg-chart-section"
        id="size-chart"
        aria-labelledby="sg-chart-title"
      >
        <div className="sg-section-heading">
          <p className="eyebrow">01 / {t("THE NUMBERS")}</p>
          <h2 id="sg-chart-title">{t("A GOOD FIT STARTS HERE.")}</h2>
          <p>{t("Measure yourself, then find your range below.")}</p>
        </div>
        <div className="sg-chart-layout">
          <div className="sg-chart-main">
            <div className="sg-chart-controls">
              <div
                className="sg-categories"
                role="group"
                aria-label={t("Size chart category")}
              >
                {categories.map((name) => (
                  <button
                    type="button"
                    key={name}
                    aria-pressed={category === name}
                    aria-controls="sg-chart-content"
                    onClick={() => setCategory(name)}
                  >
                    {t(name)}
                  </button>
                ))}
              </div>
              {category === "Clothing" && (
                <div
                  className="sg-units"
                  role="group"
                  aria-label={t("Measurement units")}
                >
                  {(["cm", "in"] as const).map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-label={t(value === "cm" ? "Centimeters" : "Inches")}
                      aria-pressed={unit === value}
                      onClick={() => setUnit(value)}
                    >
                      {value.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div id="sg-chart-content" className="sg-chart-content">
              {category === "Clothing" ? (
                <table className="sg-table">
                  <caption>
                    {t("Body measurements")} ·{" "}
                    {t(unit === "cm" ? "Centimeters" : "Inches")}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("Size")}</th>
                      {measurements.map(({ name }, index) => (
                        <th key={name} scope="col">
                          <span className="sg-column-number">0{index + 1}</span>
                          {t(name)}{" "}
                          <span className="sg-column-unit">({unit})</span>
                        </th>
                      ))}
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
              ) : category === "Socks" ? (
                <table className="sg-table">
                  <caption>{t("Everyday socks")}</caption>
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
                <div className="sg-cap-guide">
                  <span className="eyebrow">
                    {t("ONE LESS THING TO MEASURE")}
                  </span>
                  <h3>{t("One size. Your fit.")}</h3>
                  <p>
                    {t(
                      "One adjustable size. Use the back strap to find your fit.",
                    )}
                  </p>
                  <p>
                    {t(
                      "The cap should feel secure without leaving pressure around your forehead.",
                    )}
                  </p>
                </div>
              )}
            </div>
            <p className="sg-chart-note">
              {t(
                "General sizing reference for our demo collection. These are body measurements, not garment dimensions. Always check the product’s fit notes.",
              )}
            </p>
            <div className="sg-between-tip">
              <Icon name="spark" size={21} />
              <p>
                <strong>{t("Between sizes?")}</strong>{" "}
                {t(
                  "Go up for more room. For tops, start with your chest; for bottoms, check your waist and hips.",
                )}
              </p>
            </div>
          </div>
          <aside
            className="sg-measure-card"
            aria-labelledby="sg-measure-card-title"
          >
            <div className="sg-measure-card-top">
              <span className="eyebrow">{t("MADE TO MEASURE")}</span>
              <Icon name="plus" size={17} />
            </div>
            <MeasuringFigure />
            <div className="sg-measure-card-bottom">
              <h3 id="sg-measure-card-title">{t("Start with you.")}</h3>
              <p>
                {t(
                  "A soft tape. A relaxed stance. Keep it level and snug, with a little breathing room.",
                )}
              </p>
              <a href="#how-to-measure" className="sg-text-link">
                {t("HOW TO MEASURE")}
                <Icon name="arrow" size={16} />
              </a>
            </div>
          </aside>
        </div>
      </section>

      <section
        className="sg-measuring-section"
        id="how-to-measure"
        aria-labelledby="sg-measuring-title"
      >
        <div className="sg-section-heading">
          <p className="eyebrow">02 / {t("THE MEASURING BIT")}</p>
          <h2 id="sg-measuring-title">{t("THREE MEASUREMENTS. THAT’S IT.")}</h2>
          <p>
            {t(
              "Measure over light clothing. Keep the tape flat, without pulling it tight.",
            )}
          </p>
        </div>
        <div className="sg-measurement-steps">
          {measurements.map(({ name, text }, index) => (
            <div key={name}>
              <span className="sg-step-number">0{index + 1}</span>
              <div>
                <h3>{t(name)}</h3>
                <p>{t(text)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        className="sg-fit-section"
        id="find-your-fit"
        aria-labelledby="sg-fit-title"
      >
        <div className="sg-section-heading">
          <p className="eyebrow">03 / {t("THE FEEL")}</p>
          <h2 id="sg-fit-title">{t("SAME YOU. DIFFERENT FITS.")}</h2>
          <p>{t("Size is a measurement. Fit is how you like to wear it.")}</p>
        </div>
        <div className="sg-fits">
          {fits.map((fit, index) => (
            <article key={fit.name} className="sg-fit">
              <div className="sg-fit-visual">
                <span className="eyebrow">
                  0{index + 1} / {t(fit.label)}
                </span>
                <FitDrawing shape={fit.shape} />
              </div>
              <h3>{t(fit.name)}</h3>
              <p>{t(fit.text)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="sg-faq" aria-labelledby="sg-faq-title">
        <div className="sg-section-heading">
          <p className="eyebrow">{t("A LITTLE EXTRA HELP")}</p>
          <h2 id="sg-faq-title">{t("GOOD QUESTIONS.")}</h2>
        </div>
        <div className="sg-questions">
          {questions.map(({ question, answer }) => (
            <details key={question}>
              <summary>
                {t(question)}
                <Icon name="plus" size={18} />
              </summary>
              <p>{t(answer)}</p>
            </details>
          ))}
        </div>
      </section>

      <div className="sg-closing">
        <div>
          <p className="eyebrow">{t("ALL SIZES. ALL PACES.")}</p>
          <h2>{t("MAKE YOURSELF COMFORTABLE.")}</h2>
        </div>
        <Link
          href={href("/category/new-arrivals")}
          className="button button-dark"
        >
          {t("EXPLORE THE ROTATION")}
          <Icon name="arrow" size={18} />
        </Link>
      </div>
    </div>
  );
}
