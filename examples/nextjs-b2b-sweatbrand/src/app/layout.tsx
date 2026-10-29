import { Anton, Geist, Geist_Mono } from "next/font/google"
import type { Metadata } from "next"
import { Providers } from "@/components/providers"
import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import { BRAND, clientConfig } from "@/lib/config"
import "./globals.css"

// Same type as the retail store: Anton for display, Geist for everything else.
const sans = Geist({ variable: "--font-sans", subsets: ["latin"] })
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] })
const display = Anton({ variable: "--font-display", subsets: ["latin"], weight: "400" })

export const metadata: Metadata = {
  title: { default: `${BRAND} — Wholesale catalogue`, template: `%s · ${BRAND}` },
  description: "Wholesale activewear and basics for clothing retailers. Trade accounts only.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <Providers config={clientConfig()}>
          <SiteHeader />
          <main className="page">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  )
}
