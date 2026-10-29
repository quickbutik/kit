"use client"

import type { ShopkitConfig } from "@quickbutik/kit"
import { ShopkitProvider } from "@quickbutik/kit/react"
import type { ReactNode } from "react"

export function Providers({ config, children }: { config: ShopkitConfig; children: ReactNode }) {
  return (
    <ShopkitProvider config={config} consent={{ lang: "en" }}>
      {children}
    </ShopkitProvider>
  )
}
