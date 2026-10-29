"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { useSession } from "@/lib/use-session"
import { SkeletonText } from "./skeleton"

export function CatalogIntro({ styles, children }: { styles: number; children?: ReactNode }) {
  const { isLoggedIn, customer, settled } = useSession()

  return (
    <section className="intro">
      <div className="intro__lead">
        <p className="eyebrow eyebrow--square">Wholesale · {styles} styles</p>
        <h1 className="display-title">
          The catalogue<span className="dot">.</span>
        </h1>
        {children}
      </div>
      <div className="intro__side">
        {!settled ? (
          <p className="intro__note">
            <SkeletonText lines={3} lineHeight="1.7em" />
          </p>
        ) : isLoggedIn ? (
          <p className="intro__note">
            Signed in{customer?.companyName ? ` as ${customer.companyName}` : ""}. Type units per colour and size — every
            cell is saved straight to your order sheet.
          </p>
        ) : (
          <p className="intro__note">
            Browse the full range. Wholesale prices and ordering are for trade accounts —{" "}
            <Link href="/login">sign in</Link> or <Link href="/register">open an account</Link>.
          </p>
        )}
        <p className="intro__tag">All prices SEK ex. moms</p>
      </div>
    </section>
  )
}
