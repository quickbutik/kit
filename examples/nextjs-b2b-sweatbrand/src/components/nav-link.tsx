"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Suspense, type ComponentProps } from "react"

type NavLinkProps = ComponentProps<typeof Link> & { href: string }

/**
 * A Link marked aria-current on its own page. Reading the pathname is URL data
 * under Cache Components, so it sits in its own Suspense boundary and the rest of
 * the header stays in the static shell; the fallback is the same link, unmarked.
 */
export function NavLink(props: NavLinkProps) {
  return (
    <Suspense fallback={<Link {...props} />}>
      <ActiveLink {...props} />
    </Suspense>
  )
}

function ActiveLink(props: NavLinkProps) {
  const pathname = usePathname()
  return <Link {...props} aria-current={pathname === props.href ? "page" : undefined} />
}
