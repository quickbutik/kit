"use client"

import { useCart } from "@quickbutik/kit/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BRAND } from "@/lib/config"
import { useSession } from "@/lib/use-session"
import { Logo } from "./logo"
import { NavLink } from "./nav-link"
import { Skeleton } from "./skeleton"

const NAV = [
  { href: "/", label: "Catalogue" },
  { href: "/levels", label: "Levels" },
]

export function SiteHeader() {
  const { customer, isLoggedIn, logout, ready, settled } = useSession()
  const cart = useCart()
  const router = useRouter()

  const itemCount = ready ? cart.itemCount : 0
  const accountName = customer?.companyName || [customer?.firstName, customer?.lastName].filter(Boolean).join(" ")

  return (
    <header className="site-header">
      <div className="topbar">
        <p>Trade only. Wholesale.</p>
        <p className="topbar__center">All prices ex. moms — moms &amp; shipping at checkout</p>
        <p className="topbar__end">
          <Link href="/levels">Up to 25% off with levels →</Link>
        </p>
      </div>

      <div className="masthead">
        <Link href="/" className="masthead__logo" aria-label={`${BRAND} — catalogue`}>
          <Logo aria-hidden />
          <span className="masthead__b2b">B2B</span>
        </Link>

        <nav className="masthead__nav" aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="masthead__actions">
          {!settled ? (
            <span className="masthead__pending">
              <Skeleton width={22} height={22} style={{ borderRadius: "50%" }} />
              <Skeleton width={120} height={16} />
            </span>
          ) : isLoggedIn ? (
            <>
              <NavLink href="/account" className="masthead__account">
                <UserIcon />
                <span>{accountName || "Account"}</span>
              </NavLink>
              <button
                type="button"
                className="link-button masthead__signout"
                onClick={async () => {
                  await logout()
                  router.push("/")
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="masthead__account">
                <UserIcon />
                <span>Sign in</span>
              </Link>
              <Link href="/register" className="button button--small">
                Open trade account
              </Link>
            </>
          )}
          <NavLink href="/order" className="order-link">
            <BagIcon />
            <span>Order sheet</span>
            <span className="order-link__count" aria-label={ready ? `${itemCount} units` : undefined}>
              {ready ? itemCount : <Skeleton width={12} height={12} />}
            </span>
          </NavLink>
        </div>
      </div>
    </header>
  )
}

function UserIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" strokeLinecap="round" />
    </svg>
  )
}

function BagIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M5 8h14l-1 13H6L5 8Z" strokeLinejoin="round" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  )
}
