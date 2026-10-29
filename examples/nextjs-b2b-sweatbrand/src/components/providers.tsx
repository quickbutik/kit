"use client"

import type { ShopkitConfig } from "@quickbutik/kit"
import { ShopkitProvider } from "@quickbutik/kit/react"
import type { ReactNode } from "react"
import { CookieBanner } from "./cookie-banner"
import { PriceBookProvider } from "./price-book"

export function Providers({ config, children }: { config: ShopkitConfig; children: ReactNode }) {
  return (
    <ShopkitProvider
      config={config}
      consent={{ lang: "en", unstyled: true, banner: (state) => <CookieBanner state={state} /> }}
    >
      <PriceBookProvider>{children}</PriceBookProvider>
    </ShopkitProvider>
  )
}
