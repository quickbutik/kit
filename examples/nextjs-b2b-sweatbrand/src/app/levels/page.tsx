import type { Metadata } from "next"
import { LevelCards } from "./level-cards"

export const metadata: Metadata = {
  title: "Levels",
  description: "Trade levels at Sweatbrand B2B: default wholesale prices, 10% off or 25% off.",
}

export default function LevelsPage() {
  return (
    <section className="levels-page">
      <header className="section-head">
        <div>
          <p className="eyebrow eyebrow--square">Trade levels</p>
          <h1 className="display-title">
            Levels<span className="dot">.</span>
          </h1>
        </div>
        <p className="section-head__aside">
          Every trade account sits on a level. Your level&apos;s discount is already applied to every price you see in
          the catalogue — no codes, no extra steps.
        </p>
      </header>

      <LevelCards />

      <p className="levels-page__note">
        All prices SEK ex. moms. Discounts apply to the default wholesale price of every style.
      </p>
    </section>
  )
}
