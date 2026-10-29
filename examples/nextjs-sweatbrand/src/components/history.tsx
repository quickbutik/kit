"use client";

import Image from "next/image";
import Link from "next/link";
import { SEO } from "@quickbutik/kit/react";
import Icon from "./icons";
import Logo from "./logo";
import { usePreferences } from "./store-preferences";
import "./size-guide.css";
import "./history.css";

const chapters = [
  {
    label: "THE MINDSET",
    title: "Move in your own way.",
    text: "We’re here for the everyday athletes. The ones who show up, move a little, and make it their own. Good gear for whatever your kind of movement looks like.",
  },
  {
    label: "THE ROTATION",
    title: "One wardrobe. More of your day.",
    text: "Training essentials alongside easy layers and off-duty favorites. The rotation brings the gym and the street a little closer together.",
  },
  {
    label: "THE LONG RUN",
    title: "Keep your favorites in play.",
    text: "Getting to know your fit. Taking care of your clothes. Reaching for the pieces that feel like you, again and again.",
  },
] as const;

export default function History() {
  const { t, href } = usePreferences();
  return (
    <div className="history-page">
      <SEO
        title={t("Our story")}
        description={t(
          "The story behind SWEATBRAND: a concept brand bringing a street state of mind to training wear and everyday essentials. All paces welcome.",
        )}
        url={href("/history")}
      />
      <nav className="sg-breadcrumbs" aria-label={t("Breadcrumbs")}>
        <Link href={href("/")}>{t("Home")}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{t("Our story")}</span>
      </nav>

      <header className="history-intro">
        <div>
          <p className="eyebrow">
            <span className="mini-square" />
            {t("THE SWEATBRAND STORY")}
          </p>
          <h1>
            {t("A STREET STATE")}
            <br />
            {t("OF MIND.")}
          </h1>
        </div>
        <div className="history-intro-copy">
          <p>
            {t(
              "Training wear. Everyday essentials. One rotation for all the hours in between.",
            )}
          </p>
          <p>
            {t(
              "SWEATBRAND brings the easy shapes of streetwear to a daily rotation of workout essentials. For people who move in their own way.",
            )}
          </p>
          <a href="#the-idea" className="sg-text-link">
            {t("THIS IS SWEATBRAND")}
            <Icon name="arrow" size={18} />
          </a>
        </div>
      </header>

      <figure className="history-cover">
        <Image
          src="/images/campaign-hero.webp"
          alt={t(
            "Two everyday athletes running through a sunlit concrete cityscape",
          )}
          fill
          sizes="(max-width: 1400px) 92vw, 1280px"
          priority
        />
        <figcaption>
          <span className="eyebrow">{t("ALL PACES. ALL PLACES.")}</span>
          <h2>
            {t("FOR THE WORK.")}
            <br />
            {t("FOR THE WEEKEND.")}
          </h2>
          <span className="history-cover-footnote">
            {t("Built to move. Made for everyday.")}
          </span>
        </figcaption>
      </figure>
      <div className="history-caption">
        <span>{t("GOOD GEAR. GOOD ENERGY.")}</span>
        <span>{t("ALL PACES WELCOME.")}</span>
      </div>

      <section
        className="history-idea"
        id="the-idea"
        aria-labelledby="history-idea-title"
      >
        <div className="sg-section-heading">
          <p className="eyebrow">{t("THE IDEA")}</p>
          <h2 id="history-idea-title">
            {t("GOOD GEAR.")}
            <br />
            {t("REAL LIFE.")}
          </h2>
        </div>
        <div className="history-prose">
          <p className="history-lead">
            {t(
              "A workout is part of your day. It doesn’t have to define the whole thing.",
            )}
          </p>
          <p>
            {t(
              "There’s the warm-up. The work. The walk home. The coffee you stay for. We like clothes that feel at home in those in-between moments too.",
            )}
          </p>
          <p>
            {t(
              "That’s the thought behind SWEATBRAND: the ease of streetwear, the energy of training, and room to make both your own.",
            )}
          </p>
        </div>
      </section>

      <section className="history-chapters" aria-label={t("The SWEATBRAND way")}>
        {chapters.map((chapter, index) => (
          <article key={chapter.label}>
            <div className="history-chapter-index">
              <span>0{index + 1}</span>
              <span className="eyebrow">{t(chapter.label)}</span>
            </div>
            <h3>{t(chapter.title)}</h3>
            <p>{t(chapter.text)}</p>
            {index === 2 && (
              <Link className="sg-text-link" href={href("/washing-guide")}>
                {t("CARE FOR YOUR FAVORITES")}
                <Icon name="arrow" size={16} />
              </Link>
            )}
          </article>
        ))}
      </section>

      <section
        className="history-everyday"
        aria-labelledby="history-everyday-title"
      >
        <div className="history-everyday-photo">
          <Image
            src="/images/hero-men-gym-v2.webp"
            alt={t("An athlete training with dumbbells in a city gym")}
            fill
            sizes="(max-width: 700px) 90vw, 45vw"
          />
        </div>
        <div className="history-everyday-copy">
          <p className="eyebrow">{t("GOOD PEOPLE. GOOD MOVEMENT.")}</p>
          <h2 id="history-everyday-title">
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
              "Whatever your pace, there’s a place for you here. The Everyday Club is another way to make the daily rotation your own.",
            )}
          </p>
          <Link href={href("/club")} className="sg-text-link">
            {t("DISCOVER THE CLUB")}
            <Icon name="arrow" size={18} />
          </Link>
        </div>
      </section>

      <aside
        className="history-concept"
        aria-labelledby="history-concept-title"
      >
        <span className="history-concept-mark" aria-hidden="true">
          <Logo />
        </span>
        <div>
          <h2 id="history-concept-title">{t("A concept, brought to life.")}</h2>
          <p>
            {t(
              "SWEATBRAND is a concept store. The brand, products and campaign imagery are a design demo, built around an idea of everyday movement.",
            )}
          </p>
        </div>
      </aside>

      <div className="sg-closing">
        <div>
          <p className="eyebrow">{t("YOUR NEXT EVERYDAY FAVORITE")}</p>
          <h2>{t("FIND YOUR KIND OF MOVEMENT.")}</h2>
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
