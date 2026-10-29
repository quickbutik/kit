import type { Metadata, Viewport } from "next"
import { Bricolage_Grotesque, Caveat, Fraunces, Instrument_Sans, JetBrains_Mono } from "next/font/google"
import { clientConfig } from "@/lib/shopkit"
import { Providers } from "./providers"
import "./globals.css"

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" })
const body = Instrument_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" })
const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif", display: "swap", style: ["normal", "italic"] })
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" })
const script = Caveat({ subsets: ["latin"], variable: "--font-script", display: "swap" })

export const metadata: Metadata = {
  title: { default: "Custom Signs — design your own sign", template: "%s · Custom Signs" },
  description:
    "Pick a sign, upload your images and place them freely. Aluminium, acrylic, wood and banners, printed and shipped.",
}

export const viewport: Viewport = {
  themeColor: "#f6f3ec",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${serif.variable} ${mono.variable} ${script.variable}`}
    >
      <body>
        <Providers config={clientConfig()}>{children}</Providers>
      </body>
    </html>
  )
}
