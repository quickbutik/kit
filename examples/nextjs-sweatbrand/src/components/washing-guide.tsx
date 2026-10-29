"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { SEO } from "@quickbutik/kit/react";
import Icon from "./icons";
import { usePreferences } from "./store-preferences";
import "./size-guide.css";
import "./washing-guide.css";

// General care advice, not product-specific washing specifications:
// https://www.nike.com/a/take-care-workout-clothes
// https://www.nike.com/a/how-to-wash-sports-bra
// https://www.nike.com/a/how-to-wash-baseball-cap
// https://www.ginetex.net/share/article/4201/care-symbols
const careTypes = [
  {
    name: "Training wear",
    heading: "A fresh start for your next session.",
    description:
      "For stretch leggings, sports bras and technical tops. A little gentleness helps protect the fabric and its feel.",
    wash: "Turn inside out and use a cool, gentle cycle if the label allows machine washing. Keep rough fabrics and towels in a separate load.",
    dry: "Reshape and air dry on a rack. Keep performance fabrics away from radiators and high dryer heat.",
    extra:
      "Skip fabric softener and dryer sheets. Use the detergent dose recommended for your load and water hardness, rather than adding extra for sweaty kit.",
    note: "A mesh laundry bag gives delicate straps and stretch fabrics a little extra protection.",
  },
  {
    name: "Cotton & sweats",
    heading: "Keep the easy pieces feeling easy.",
    description:
      "For everyday tees, hoodies and joggers. Protect the color, print and shape that made them a favorite.",
    wash: "Wash with similar colors, turn printed pieces inside out and choose the temperature on the label. Avoid overfilling the drum.",
    dry: "Gently reshape while damp. Air dry; support heavier pieces across a rack so they do not stretch under their own weight.",
    extra:
      "If the label allows ironing, use its heat setting and work on the reverse. Keep the iron off prints and embellishments.",
    note: "A care label’s temperature is the maximum permitted, not a target you always need to reach.",
  },
  {
    name: "Caps & socks",
    heading: "Small essentials. Same care.",
    description:
      "The finishing touches deserve a little attention too. Caps and socks need different routines.",
    wash: "For caps, check the label before getting them wet. If washable, gently clean with cool water and mild detergent. Wash socks with similar colors as their label directs.",
    dry: "Reshape a washable cap and air dry away from direct heat. Follow the socks’ drying instructions to protect their stretch.",
    extra:
      "Avoid wringing a cap or forcing its brim out of shape. A mesh bag can help keep pairs of socks together in the wash.",
    note: "Never assume a cap is machine washable. The brim, structure and trims can need different care.",
  },
] as const;

const habits = [
  {
    title: "Before the wash",
    text: "Empty pockets, fasten zips and turn clothes inside out. Separate colors and keep delicate training wear away from rough fabrics.",
    icon: "prepare",
  },
  {
    title: "Keep it gentle",
    text: "Start with the care label. For washable activewear, use a cool, gentle cycle and the right amount of detergent. Skip the softener.",
    icon: "wash",
  },
  {
    title: "Give it some air",
    text: "Take clothes out promptly, reshape and let them air dry. Let sweaty kit dry before putting it in the laundry basket.",
    icon: "dry",
  },
] as const;

const labelNotes = [
  {
    name: "Temperature",
    mark: "30°",
    text: "The number in the wash tub is the maximum temperature in °C. Follow the number on your own label.",
  },
  {
    name: "Gentle cycles",
    mark: "—",
    text: "A line under the wash tub means a milder cycle. Two lines call for a very mild cycle.",
  },
  {
    name: "Drying & ironing",
    mark: "••",
    text: "Dots indicate the permitted heat level. Read them together with the drying or ironing symbol.",
  },
  {
    name: "A crossed symbol",
    mark: "×",
    text: "A cross means that treatment is not allowed. A crossed-out dryer, for example, means do not tumble dry.",
  },
] as const;

const questions = [
  {
    question: "How often should I wash training wear?",
    answer:
      "Wash sweaty training wear after each session. If you cannot wash it straight away, hang it up to dry first instead of leaving it damp in a gym bag.",
  },
  {
    question: "Can I use fabric softener?",
    answer:
      "Skip it for technical training wear. Softener and dryer sheets can leave residue on the fibers, affecting how the fabric handles moisture and making odors harder to remove.",
  },
  {
    question: "Can everything go in the dryer?",
    answer:
      "Check each care label. Some garments allow low-heat tumble drying, while others must air dry. High heat can affect stretch, shape and prints. A crossed-out tumble-dryer symbol means no tumble drying.",
  },
  {
    question: "What if my clothes still smell after washing?",
    answer:
      "Let sweaty kit dry before storing it, avoid overloading the machine and check your detergent dose. Wash again according to the label with a detergent suitable for the fabric. More detergent is not always better.",
  },
] as const;

function CareDrawing({ kind }: { kind: (typeof habits)[number]["icon"] }) {
  const drawings: Record<typeof kind, ReactNode> = {
    prepare: (
      <>
        <path d="m30 32 19-9c3 15 23 15 26 0l19 9 17 25-19 13-9-13v53H41V57l-9 13-19-13Z" />
        <path d="M47 27c3 10 27 10 30 0M41 103h42" />
        <path d="m54 66 8-8 8 8M62 59v27" />
      </>
    ),
    wash: (
      <>
        <rect x="24" y="16" width="76" height="96" rx="3" />
        <path d="M24 37h76M34 27h19" />
        <circle cx="84" cy="27" r="3" />
        <circle cx="62" cy="73" r="25" />
        <path d="M39 78c8-9 14 8 23 0s15 8 23 0M52 62c3-5 7-7 12-7" />
      </>
    ),
    dry: (
      <>
        <path d="M19 24h86M28 24v83M96 24v83M28 49h68M28 75h68M20 108h17M87 108h17" />
        <path d="M43 42h33v46H43zM43 49h33M48 88v8M57 88v8M66 88v8M75 88v8" />
        <path d="m57 12 3-5M72 15l5-3" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 124 124"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {drawings[kind]}
    </svg>
  );
}

export default function WashingGuide() {
  const { t, href } = usePreferences();
  const [selected, setSelected] = useState(0);
  const care = careTypes[selected];
  return (
    <div className="washing-guide-page">
      <SEO
        title={t("Washing guide")}
        description={t(
          "Keep your everyday favorites in good shape with washing, drying and care-label advice for training wear, cotton layers and accessories.",
        )}
        url={href("/washing-guide")}
      />
      <nav className="sg-breadcrumbs" aria-label={t("Breadcrumbs")}>
        <Link href={href("/")}>{t("Home")}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{t("Washing guide")}</span>
      </nav>
      <header className="sg-hero">
        <div className="sg-hero-copy">
          <p className="eyebrow">
            <span className="mini-square" />
            {t("THE WASH & CARE GUIDE")}
          </p>
          <h1>
            {t("GOOD GEAR.")}
            <br />
            {t("GREAT CARE.")}
          </h1>
          <p className="sg-intro">
            {t(
              "Your favorites deserve a long rotation. A few good habits to keep them feeling like your favorites, wash after wash.",
            )}
          </p>
          <a href="#care-routine" className="sg-text-link">
            {t("GET THE ROUTINE")}
            <Icon name="arrow" size={18} />
          </a>
        </div>
        <div className="sg-hero-image wg-hero-image">
          <Image
            src="/images/products/04-everyday-hoodie.webp"
            alt={t("A grey everyday hoodie, ready for the next wear")}
            fill
            sizes="(max-width: 700px) 100vw, 42vw"
            priority
          />
          <span className="wg-image-caption eyebrow">
            {t("A LITTLE CARE. A LOT MORE WEAR.")}
          </span>
        </div>
      </header>
      <nav className="sg-jump-nav" aria-label={t("In this guide")}>
        <a href="#care-routine">
          <span>01</span>
          {t("The routine")}
          <Icon name="arrow" size={15} />
        </a>
        <a href="#care-by-piece">
          <span>02</span>
          {t("Care by piece")}
          <Icon name="arrow" size={15} />
        </a>
        <a href="#read-the-label">
          <span>03</span>
          {t("Read the label")}
          <Icon name="arrow" size={15} />
        </a>
      </nav>

      <section
        className="wg-section"
        id="care-routine"
        aria-labelledby="wg-routine-title"
      >
        <div className="sg-section-heading">
          <p className="eyebrow">01 / {t("THE EVERYDAY ROUTINE")}</p>
          <h2 id="wg-routine-title">{t("THREE HABITS. MORE GOOD WEARS.")}</h2>
          <p>{t("Simple steps for the pieces you reach for most.")}</p>
        </div>
        <div className="wg-habits">
          {habits.map((habit, index) => (
            <article key={habit.title}>
              <div className="wg-habit-drawing">
                <span className="eyebrow">0{index + 1}</span>
                <CareDrawing kind={habit.icon} />
              </div>
              <h3>{t(habit.title)}</h3>
              <p>{t(habit.text)}</p>
            </article>
          ))}
        </div>
        <p className="wg-label-reminder">
          <Icon name="check" size={18} />
          {t("Always follow the garment’s care label.")}
        </p>
      </section>

      <section
        className="wg-section wg-piece-section"
        id="care-by-piece"
        aria-labelledby="wg-piece-title"
      >
        <div className="sg-section-heading">
          <p className="eyebrow">02 / {t("KNOW YOUR PIECES")}</p>
          <h2 id="wg-piece-title">{t("DIFFERENT FABRICS. DIFFERENT CARE.")}</h2>
          <p>
            {t(
              "Choose a group for general guidance. Your garment’s label always comes first.",
            )}
          </p>
        </div>
        <div
          className="wg-care-selector"
          role="group"
          aria-label={t("Clothing care category")}
        >
          {careTypes.map((type, index) => (
            <button
              type="button"
              key={type.name}
              aria-pressed={selected === index}
              aria-controls="wg-care-content"
              onClick={() => setSelected(index)}
            >
              {t(type.name)}
            </button>
          ))}
        </div>
        <div className="wg-care-content" id="wg-care-content">
          <div className="wg-care-intro">
            <span className="eyebrow">{t(care.name)}</span>
            <h3>{t(care.heading)}</h3>
            <p>{t(care.description)}</p>
            <div className="wg-care-tip">
              <Icon name="spark" size={20} />
              <p>{t(care.note)}</p>
            </div>
          </div>
          <dl className="wg-care-steps">
            {[
              { name: "Wash", text: care.wash },
              { name: "Dry", text: care.dry },
              { name: "A little extra", text: care.extra },
            ].map(({ name, text }, index) => (
              <div key={name}>
                <dt>
                  <span>0{index + 1}</span>
                  {t(name)}
                </dt>
                <dd>{t(text)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section
        className="wg-section wg-label-section"
        id="read-the-label"
        aria-labelledby="wg-label-title"
      >
        <div className="sg-section-heading">
          <p className="eyebrow">03 / {t("THE SMALL PRINT")}</p>
          <h2 id="wg-label-title">{t("YOUR LABEL KNOWS BEST.")}</h2>
          <p>
            {t(
              "Those little marks tell you how to care for the whole garment, including its trims and finishes.",
            )}
          </p>
        </div>
        <div className="wg-label-notes">
          {labelNotes.map(({ name, mark, text }) => (
            <article key={name}>
              <span className="wg-label-mark" aria-hidden="true">
                {mark}
              </span>
              <div>
                <h3>{t(name)}</h3>
                <p>{t(text)}</p>
              </div>
            </article>
          ))}
        </div>
        <a
          className="sg-text-link wg-symbol-reference"
          href="https://www.ginetex.net/share/article/4201/care-symbols"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("SEE THE FULL CARE-SYMBOL GUIDE")}
          <Icon name="arrow-up" size={16} />
          <span className="sr-only">{t("Opens in a new tab")}</span>
        </a>
      </section>

      <section className="sg-faq" aria-labelledby="wg-faq-title">
        <div className="sg-section-heading">
          <p className="eyebrow">{t("A LITTLE EXTRA HELP")}</p>
          <h2 id="wg-faq-title">{t("GOOD QUESTIONS.")}</h2>
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
          <p className="eyebrow">{t("KEEP GOOD THINGS GOING")}</p>
          <h2>{t("GOOD CARE. SAME GREAT FIT.")}</h2>
        </div>
        <Link href={href("/size-guide")} className="button button-dark">
          {t("FIND YOUR FIT")}
          <Icon name="arrow" size={18} />
        </Link>
      </div>
      <p className="wg-sources">
        {t("Further reading")}
        <a
          href="https://www.nike.com/a/take-care-workout-clothes"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("Nike activewear care")}
          <Icon name="arrow-up" size={12} />
          <span className="sr-only">{t("Opens in a new tab")}</span>
        </a>
      </p>
    </div>
  );
}
