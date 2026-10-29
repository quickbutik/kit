"use client"

import { useCustomer } from "@quickbutik/kit/react"
import { useSyncExternalStore } from "react"

const noop = () => () => {}

/** False on the server and during hydration, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )
}

/**
 * useCustomer() for rendering. The kit reads the session cookie synchronously in
 * the browser, but the server can't see it, so the first client render would
 * disagree with the HTML. Until hydration is done this reports `ready: false`
 * and a guest; render a neutral placeholder for anything that depends on it.
 */
export function useSession() {
  const customer = useCustomer()
  const ready = useHydrated()
  const isLoggedIn = ready && customer.isLoggedIn
  return {
    ...customer,
    ready,
    isLoggedIn,
    customer: ready ? customer.customer : null,
    /** Known who's looking, and their profile is read if they're signed in. Use for anything showing the profile. */
    // A failed profile read counts as settled too, so a skeleton never spins forever.
    settled: ready && (!isLoggedIn || customer.customer !== null || customer.error !== null),
  }
}
