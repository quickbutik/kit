"use client"

import { useCustomerClub } from "@quickbutik/kit/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Skeleton } from "@/components/skeleton"
import { levelForGroup } from "@/lib/levels"
import { useSession } from "@/lib/use-session"

export function AccountDetails() {
  const { customer, isLoggedIn, logout, settled } = useSession()
  const { data: club } = useCustomerClub()
  const router = useRouter()

  if (!settled) return <AccountSkeleton />

  if (!isLoggedIn) {
    return (
      <div className="form-card">
        <p>
          You&apos;re not signed in. <Link href="/login">Sign in →</Link>
        </p>
      </div>
    )
  }

  if (!customer) return <AccountSkeleton />

  const level = levelForGroup(customer.group?.name)
  const address = customer.address
  const rows: [string, string | null | undefined][] = [
    ["Company", customer.companyName],
    ["Org. number", customer.companyNumber],
    ["Buyer", [customer.firstName, customer.lastName].filter(Boolean).join(" ")],
    ["Email", customer.email],
    ["Phone", customer.phone],
    [
      "Address",
      address ? [address.line1, address.line2, [address.postalCode, address.city].filter(Boolean).join(" "), address.country].filter(Boolean).join(", ") : null,
    ],
    ["Level", `${level.name}${level.discount ? ` — ${level.discount}% off` : " — default prices"}`],
    ["Club points", club?.member ? `${club.points.balance} (${club.reward.remaining} to next reward)` : null],
  ]

  return (
    <div className="form-card">
      <p className="form-card__aside">
        <span className="muted">To change company details, contact us.</span>
        <button
          type="button"
          className="link-button"
          onClick={async () => {
            await logout()
            router.push("/")
          }}
        >
          Sign out
        </button>
      </p>
      <p className="form-card__aside">
        <Skeleton width={220} height={14} />
        <Skeleton width={60} height={14} />
      </p>
      <dl className="spec">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    </div>
  )
}

function AccountSkeleton() {
  return (
    <div className="form-card" aria-busy>
      <dl className="spec">
        {["Company", "Org. number", "Buyer", "Email", "Level"].map((label) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <Skeleton width="60%" height={15} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
