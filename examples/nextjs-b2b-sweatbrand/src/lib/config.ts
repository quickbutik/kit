export const BRAND = "Sweatbrand B2B"

export function publishableKey(): string {
  const key = process.env.NEXT_PUBLIC_QUICKBUTIK_PUBLISHABLE_KEY
  if (!key) throw new Error("NEXT_PUBLIC_QUICKBUTIK_PUBLISHABLE_KEY is not set")
  return key
}

/** Plain config for <ShopkitProvider>; a client instance can't cross the server/client boundary. */
export function clientConfig() {
  return { publishableKey: publishableKey() }
}
