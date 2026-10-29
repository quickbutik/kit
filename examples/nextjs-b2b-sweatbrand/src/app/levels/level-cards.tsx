"use client"

import Link from "next/link"
import { Skeleton } from "@/components/skeleton"
import { LEVELS, levelForGroup } from "@/lib/levels"
import { money } from "@/lib/money"
import { useSession } from "@/lib/use-session"

/** A worked example on a 1 000 kr order, so the percentages read as money. */
const EXAMPLE = 100_000

export function LevelCards() {
  const { isLoggedIn, customer, settled } = useSession()
  const current = isLoggedIn && customer ? levelForGroup(customer.group?.name).level : null

  return (
    <>
      <ol className="levels">
        {LEVELS.map((level) => {
          const isCurrent = level.level === current
          return (
            <li key={level.level} className={`level${isCurrent ? " level--current" : ""}`}>
              <div className="level__top">
                <p className="level__name">{level.name}</p>
                {isCurrent && <span className="level__badge">Your level</span>}
              </div>
              <p className="level__discount">
                {level.discount === 0 ? (
                  "Default"
                ) : (
                  <>
                    −{level.discount}
                    <span className="level__pct">%</span>
                  </>
                )}
              </p>
              <p className="level__desc">
                {level.discount === 0 ? "Default wholesale prices." : `${level.discount}% off default wholesale prices.`}
              </p>
              <dl className="level__example">
                <div>
                  <dt>Order at default prices</dt>
                  <dd>{money(EXAMPLE)}</dd>
                </div>
                <div>
                  <dt>You pay</dt>
                  <dd>{money(Math.round((EXAMPLE * (100 - level.discount)) / 100))}</dd>
                </div>
              </dl>
            </li>
          )
        })}
      </ol>

      {/* The same slot for everyone, so the page doesn't move once we know who's looking. */}
      <p className="levels-cta">
        {!settled ? (
          <>
            <Skeleton width={230} height={54} />
            <Skeleton width={300} height={15} />
          </>
        ) : isLoggedIn ? (
          <>
            <Link href="/" className="button">
              Go to the catalogue
            </Link>
            <span>
              You&apos;re on {LEVELS.find((l) => l.level === current)?.name ?? "Level 1"} — your discount is already in
              every price.
            </span>
          </>
        ) : (
          <>
            <Link href="/register" className="button">
              Open a trade account
            </Link>
            <span>
              Already trading with us? <Link href="/login">Sign in</Link> to see your level.
            </span>
          </>
        )}
      </p>
    </>
  )
}
