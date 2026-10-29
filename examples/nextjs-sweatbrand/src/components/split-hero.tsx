"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import Icon from "./icons";
import { usePreferences } from "./store-preferences";

export type Side = "Women" | "Men";
const campaigns: { side: Side; image: string; alt: string }[] = [
  {
    side: "Women",
    image: "/images/hero-women-gym.webp",
    alt: "Sweaty athlete training with battle ropes in a dark, dusty industrial gym",
  },
  {
    side: "Men",
    image: "/images/hero-men-gym-v2.webp",
    alt: "Sweaty athlete looking left while pressing worn iron dumbbells in a dark underground weight room",
  },
];

export default function SplitHero({
  onShop,
}: {
  onShop: (side: Side) => void;
}) {
  const { t } = usePreferences();
  const [hovered, setHovered] = useState<Side | null>(null);
  const [focused, setFocused] = useState<Side | null>(null);
  const reduceMotion = useReducedMotion();
  const active = hovered ?? focused;
  const expandedShare = 53;
  const womenShare =
    active === "Women"
      ? expandedShare
      : active === "Men"
        ? 100 - expandedShare
        : 50;
  const easing: [number, number, number, number] = [0.4, 0, 0.2, 1];
  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.95, ease: easing };

  return (
    <section className="hero" aria-labelledby="hero-heading">
      <h1 id="hero-heading" className="sr-only">
        {t("Workout wear for women and men. Move your way.")}
      </h1>
      {campaigns.map(({ side, image, alt }) => (
        <motion.button
          key={side}
          className={`hero-side hero-side-${side.toLowerCase()}`}
          aria-label={t(side === "Women" ? "Shop women" : "Shop men")}
          initial={false}
          animate={{
            width: `calc(${side === "Women" ? womenShare : 100 - womenShare}% + 24px)`,
          }}
          transition={transition}
          onHoverStart={() => setHovered(side)}
          onHoverEnd={() => setHovered(null)}
          onFocus={() => setFocused(side)}
          onBlur={() => setFocused(null)}
          onClick={() => {
            setHovered(null);
            setFocused(null);
            onShop(side);
          }}
        >
          <span
            className="hero-side-photo"
            style={{ width: `calc(${expandedShare}cqw + 24px)` }}
          >
            <Image
              src={image}
              alt={t(alt)}
              fill
              sizes="(max-width: 700px) 60vw, 65vw"
              loading="eager"
              className="hero-side-image"
            />
          </span>
          <motion.span
            className="hero-side-shade"
            initial={false}
            animate={{ opacity: active === side ? 0.9 : 1 }}
            transition={transition}
          />
          <span className="hero-side-copy">
            <span className="hero-side-title">{t(side).toUpperCase()}</span>
            <span className="hero-side-link">
              {t("SHOP ")}
              {t(side).toUpperCase()} <Icon name="arrow" size={18} />
            </span>
          </span>
        </motion.button>
      ))}
    </section>
  );
}
