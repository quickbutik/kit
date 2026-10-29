/**
 * One example of every message in the embedded-checkout contract, in both
 * directions.
 *
 * BYTE-IDENTICAL COPY. The embedded checkout (the frame) keeps the same file in
 * its own test suite. The two are deployed — and in the kit's case published —
 * separately, so neither can import the other. Both sides assert their own
 * parser against these literals instead, which keeps the two implementations
 * of the contract honest. Change it in one place and copy the file; a change
 * in only one half shows up as a failing test in that half.
 *
 * Deliberately free of imports and of any type annotation beyond `as const`:
 * that is what makes a verbatim copy compile in both projects.
 */

export const EMBED_FIXTURE_SESSION_ID = "cs_01J8Z9QK2M3N4P5R6S7T8V9W0X"
export const EMBED_FIXTURE_SHOP_ID = "101928"

/** Frame → host: every message type in the contract. */
export const embedFrameMessageFixtures = {
  ready: {
    source: "qb-checkout-embed",
    v: 1,
    type: "ready",
    sessionId: "cs_01J8Z9QK2M3N4P5R6S7T8V9W0X",
    shopId: "101928",
    step: "contact",
  },
  height: {
    source: "qb-checkout-embed",
    v: 1,
    type: "height",
    height: 1284,
  },
  "scroll-to": {
    source: "qb-checkout-embed",
    v: 1,
    type: "scroll-to",
    top: 320,
  },
  navigate: {
    source: "qb-checkout-embed",
    v: 1,
    type: "navigate",
    url: "https://shop.example.com/cart",
    reason: "back",
  },
  redirectGet: {
    source: "qb-checkout-embed",
    v: 1,
    type: "redirect",
    url: "https://checkoutshopper-test.adyen.com/checkoutshopper/checkoutPaymentRedirect?redirectData=Ab02b4c0",
    method: "GET",
  },
  redirectPost: {
    source: "qb-checkout-embed",
    v: 1,
    type: "redirect",
    url: "https://test.adyen.com/hpp/3d/validate.shtml",
    method: "POST",
    data: {
      PaReq: "eNpVUtuOgjAQ_RXDu7ZFRGvGJq7uZn1wY1Yf9rV0",
      MD: "M2RlMDAwMDAwMDAwMDAwMA",
      TermUrl: "https://pay.quickbutik.com/checkout/return",
    },
  },
  complete: {
    source: "qb-checkout-embed",
    v: 1,
    type: "complete",
    sessionId: "cs_01J8Z9QK2M3N4P5R6S7T8V9W0X",
    orderNumber: 100244,
    successUrl: "https://shop.example.com/success/100244?hash=8f14e45f&t=1757836800",
  },
  "demo-complete": {
    source: "qb-checkout-embed",
    v: 1,
    type: "demo-complete",
    sessionId: "cs_01J8Z9QK2M3N4P5R6S7T8V9W0X",
    configureUrl: "https://quickbutik.com/claim/101928",
  },
  error: {
    source: "qb-checkout-embed",
    v: 1,
    type: "error",
    code: "payment-failed",
    message: "The payment was refused.",
    fatal: false,
  },
  event: {
    source: "qb-checkout-embed",
    v: 1,
    type: "event",
    name: "add_shipping_info",
    params: {
      currency: "SEK",
      value: 499,
      shipping_tier: "postnord_home",
      items: [{ item_id: "27", item_name: "Cotton tee", quantity: 1, price: 399 }],
    },
  },
  step: {
    source: "qb-checkout-embed",
    v: 1,
    type: "step",
    step: "payment",
  },
} as const

/** Host → frame: every message type in the contract. */
export const embedHostMessageFixtures = {
  init: {
    source: "qb-checkout-embed",
    v: 1,
    type: "init",
    hostUrl: "https://shop.example.com/checkout",
    viewport: { width: 1280, height: 800, scrollY: 240, frameTop: -120 },
  },
  viewport: {
    source: "qb-checkout-embed",
    v: 1,
    type: "viewport",
    viewport: { width: 1280, height: 800, scrollY: 640, frameTop: -520 },
  },
  focus: {
    source: "qb-checkout-embed",
    v: 1,
    type: "focus",
  },
  "cart-updated": {
    source: "qb-checkout-embed",
    v: 1,
    type: "cart-updated",
  },
} as const

/**
 * Envelopes that BOTH sides must reject.
 *
 * These matter more than the acceptances. A parser that accepts every fixture
 * above and also accepts a `javascript:` redirect has passed the easy half of
 * the contract and failed the half that keeps a merchant's page safe: a
 * `javascript:` URL handed to the host's `location.assign` executes on the
 * merchant's own origin.
 *
 * Keyed by what is wrong with them, so a failure names the hole.
 */
export const embedRejectedFixtures = {
  "no source": { v: 1, type: "height", height: 100 },
  "foreign source": {
    source: "qb-checkout-preview",
    v: 1,
    type: "height",
    height: 100,
  },
  "unknown version": {
    source: "qb-checkout-embed",
    v: 2,
    type: "height",
    height: 100,
  },
  "unknown type": { source: "qb-checkout-embed", v: 1, type: "teleport" },
  "javascript navigate": {
    source: "qb-checkout-embed",
    v: 1,
    type: "navigate",
    url: "javascript:alert(document.cookie)",
    reason: "back",
  },
  "data redirect": {
    source: "qb-checkout-embed",
    v: 1,
    type: "redirect",
    url: "data:text/html,<h1>x",
    method: "GET",
  },
  "plain http redirect on a public host": {
    source: "qb-checkout-embed",
    v: 1,
    type: "redirect",
    url: "http://test.adyen.com/hpp",
    method: "GET",
  },
  "unknown redirect method": {
    source: "qb-checkout-embed",
    v: 1,
    type: "redirect",
    url: "https://test.adyen.com/hpp",
    method: "PUT",
  },
  "complete with an unsafe successUrl": {
    source: "qb-checkout-embed",
    v: 1,
    type: "complete",
    sessionId: "cs_01J8Z9QK2M3N4P5R6S7T8V9W0X",
    orderNumber: 100244,
    successUrl: "javascript:void 0",
  },
  "ready without a session": {
    source: "qb-checkout-embed",
    v: 1,
    type: "ready",
    shopId: "101928",
    step: "contact",
  },
  "ready with an unknown step": {
    source: "qb-checkout-embed",
    v: 1,
    type: "ready",
    sessionId: "cs_01J8Z9QK2M3N4P5R6S7T8V9W0X",
    shopId: "101928",
    step: "review",
  },
  "init with a partial viewport": {
    source: "qb-checkout-embed",
    v: 1,
    type: "init",
    hostUrl: "https://shop.example.com/checkout",
    viewport: { width: 1280 },
  },
  "init with an unsafe hostUrl": {
    source: "qb-checkout-embed",
    v: 1,
    type: "init",
    hostUrl: "javascript:1",
    viewport: { width: 1280, height: 800, scrollY: 0, frameTop: 0 },
  },
  "not an object": "qb-checkout-embed",
  null: null,
} as const
