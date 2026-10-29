"use client"

import { ConsentSettingsButton } from "@quickbutik/kit/react"
import { BRAND } from "@/lib/config"

export function SiteFooter() {
  return (
    <footer className="colophon">
      <p>
        {BRAND} <span aria-hidden>·</span> Trade sales only <span aria-hidden>·</span> All prices in SEK, ex. moms. Moms
        and shipping are added at checkout.
      </p>
      <p className="colophon__links">
        <a href="https://sweatshop-b2b.quickbutik.com/sidor/kopvillkor" target="_blank" rel="noreferrer">
          Terms of trade
        </a>
        <ConsentSettingsButton className="link-button" />
      </p>
    </footer>
  )
}
