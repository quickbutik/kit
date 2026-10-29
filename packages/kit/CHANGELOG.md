# @quickbutik/kit

## 1.12.0

### Minor Changes

- 09346d3: Product fields ("produktfält"). `AddCartItemInput` takes `properties?: { propertyId, value }[]` — the text for a `shorttext`/`longtext` field, `"1"` for a ticked `checkbox`, the original file name for a `file` field — and every add path sends it: `cart.addItem`, `cart.add`, `checkout.buyNow`, `CartStore.add`/`buyNow`, `useCart().add`, `useCheckout().buyNow`, and `useProductAddToCart()`'s `addToCart(quantity, properties)` / `buyNow(input, quantity, properties)`. Only `propertyId` and `value` go on the wire, and a plain add (no input, or `[]`) sends the body it always did. The same product and variant with different input is a separate line server-side; `CartItem.properties?: CartItemProperty[]` types the resolved input (`propertyId`, `value`, `title`, `type`, `price` in minor units; `title`/`type` null once the field no longer exists), absent on a line without input. `Product.fields?: ProductField[]` types the fields a product asks for (`id`, `type`, `title`, `required`, `price`). Lines are now keyed with their input wherever the kit keys them by content, so the analytics cart diff reports a second line of the same variant as an `add_to_cart`, and the checkout session's stale-cart check notices a line swapped for other input. New exports `CartItemProperty`, `CartItemPropertyInput`, `ProductField` and `ProductFieldType`.

## 1.11.0

### Minor Changes

- 06b24ef: Newsletter sign-up. `kit.newsletter.isEnabled()` resolves `true` when the shop takes sign-ups (the newsletter app is on and a provider is configured, stricter than `Shop.newsletterEnabled`, which only says the app is on), read once per client like `customers.config()` and forgotten after a failed read; it is the gate for rendering a sign-up form. `kit.newsletter.subscribe({ email, firstName?, lastName? })` hands the address to the merchant's newsletter provider (GetaNewsletter, Mailchimp or Rule) and resolves with nothing; an address already subscribed succeeds again, and no customer token is sent with either call. Refusals are a plain `ShopkitApiError` (never a `ShopkitAuthError`) with `code` `newsletter_invalid_email` (422), `newsletter_disabled` (409), `newsletter_subscribe_failed` (502, the provider refused or was unreachable) or `rate_limited` (429). New scope `newsletter:subscribe`, in `SHOPKIT_SCOPES` and `DEFAULT_SHOPKIT_SCOPES`; `isEnabled()` also works with `storefront:read` alone. New exports `NewsletterResource` and `NewsletterSubscribeInput`. `window.Quickbutik.client.newsletter` works in the script-tag build too.

## 1.10.0

### Minor Changes

- 930bd50: Customer registration and password reset. `customers.register()` creates an account and resolves with a result to switch on: `{ status: "logged_in", ...session }` for a new email, logged in exactly like `login()` (session stored, `onChange` and `qb:customer` fire, another customer's cart forgotten), or `{ status: "verification_required" }` for the email of an earlier guest customer, where a code is emailed and `resetPassword()` finishes the registration, or rarely `{ status: "login_required" }` when the account was created but no session could be opened. `customers.requestPasswordReset({ email })` emails a one-time code and resolves whether or not the account exists; `customers.resetPassword({ email, code, password })` sets the new password and logs in like `login()`, or throws `ShopkitAuthError` `password_changed_login_required` when the password was changed but no session could be opened. `useCustomer()` returns `register`, `requestPasswordReset` and `resetPassword` too. New `ShopkitAuthError` codes: `signup_disabled`, `email_taken`, `invalid_email`, `invalid_name`, `invalid_password`, `invalid_reset_code`, and the kit-side `password_changed_login_required`. New types `CustomerRegisterInput`, `CustomerRegisterResult`, `CustomerPasswordResetRequestInput`, `CustomerPasswordResetInput`.

## 1.9.1

### Patch Changes

- 862e40c: Document that `currency` on `checkout.start()` / `createSession()` also applies to shops on the legacy checkout: with the merchant's own exchange rate for an offered currency the order is priced and charged in it, otherwise the order stays in the shop currency and the checkout can show an approximate total. No code change; the platform now honours the field on both checkouts.

## 1.9.0

### Minor Changes

- 9d968cc: Customer accounts for headless storefronts: `kit.customers` (`config()`, `login()`, `logout()`, `isLoggedIn`, `onChange()` plus a `qb:customer` DOM event, `me()`, `setSession()`, `getAccessToken()`, `club.get()`). A logged-in customer's token is sent as `X-Customer-Token` with every request, renewed before it expires and once (single-flight) on `customer_token_expired`; a refused token ends the session and GETs fall back to guest prices. The session is stored under `<prefix>_customer_session` through the client's storage adapter, so a server can keep it in an httpOnly cookie. New `ShopkitAuthError` (a `ShopkitApiError` with a `code`), `code` on every `ShopkitApiError`, the `customer:session` scope (in the default set), `useCustomer()` and `useCustomerClub()`, catalog hooks and `useCart()` refetching on login and logout, product-cache keys per customer, optional `price.source` and `price.hidden` on variant prices, and who a catalog read was priced for as `page.meta.pricing` on lists and searches and `product.pricing` on single reads (the response envelope's `pricing` is no longer a reason to skip unwrapping it). `customers.config()` accepts `customer:session` or `storefront:read`. Sessions stay in step across tabs and clients sharing one storage (storage re-read before every renewal, Web Locks where available, `storage` / `visibilitychange` sync), an unusable stored session is dropped as soon as it is read, expiries are timed from receipt so device clock skew does not matter, storage that cannot be written (`StorageAdapter.writable: false`, or `customerSession: { renew: false }`) never renews, and the remembered-cart calls and `CartStore` forget a cart bound to another customer (`cart.forgetCurrent()`). `rate_limited` is an auth error only from `/account/*`. The `qb:customer` event carries `{ customerId }` only; product and cart elements re-read on login and logout. Script-tag bundle: 51.4 KB to 54.9 KB gzipped, within the existing 55.7 KB budget.

## 1.8.0

### Minor Changes

- 3f68011: Cookie consent and consent-gated analytics for headless storefronts, **on by
  default**.

  ```tsx
  <ShopkitProvider
    config={{ publishableKey }}
    consent={{ lang: "sv", privacyPolicyUrl: "/integritetspolicy" }}
  >
    <App />
  </ShopkitProvider>
  ```

  ```html
  <script
    defer
    src="…/quickbutik-kit.global.js"
    data-publishable-key="qb_pk_…"
    data-consent-lang="sv"
  ></script>
  ```

  **Behaviour change for existing installs.** After upgrading, every storefront
  built on `<ShopkitProvider>`, `configure()`, `<qb-shop>` or the script tag
  shows a cookie consent banner, and once the shopper agrees loads the GA4 / GTM
  / Meta pixel configured for the shop in the Quickbutik admin
  (`shop.tracking`). Analytics is fail-closed: nothing from Google is loaded
  before `analytics` is granted (Consent Mode's denied `default` and the
  `update` are still pushed ahead of the script), nor Meta before `marketing`. A
  shop with no tracking ids gets the banner and sends nothing.

  **Checkouts carry the decision, server-started ones included.** Every handoff
  the browser performs, and now `checkout.start()` on a server client with a
  cookie accessor (a Next.js server action), appends `consentCategories` to the
  hosted checkout URL; an undecided shopper is forwarded as denied
  (`consentCategories=`).

  **Opt out with `consent: false` in your config.** That one switch is read by
  the browser and the server alike and restores the previous behaviour exactly:
  `createShopkitClient({ …, consent: false })` / `<ShopkitProvider config={{ …,
consent: false }}>`, `configure({ consent: false })`,
  `<qb-shop consent="false">`, or `data-consent="false"` on the script tag. The
  `<ShopkitProvider consent>` prop only carries options; `consent={false}` there
  still works for that React tree but is deprecated and warns, because a
  server-started checkout cannot see it.

  - **Zero-config React** — `<ShopkitProvider consent>` (default on) mounts the
    consent store, the analytics hub and the default banner. Options:
    `initialState` (the server's read, no banner flash), `lang`,
    `privacyPolicyUrl`, `labels`, `revision` and the other store options,
    `analytics` (`false`, or the `<AnalyticsProvider>` options such as extra
    `destinations`), `banner` (`false`, or a render function), `unstyled`. A
    provider nested inside another (a campaign `storefrontId` provider inside
    the site's) reuses its consent store, banner and hub, and reports its own
    cart into the shared hub; an explicit `<ConsentProvider>` above is reused;
    an explicit `<ConsentBanner>` below replaces the default one; a
    `<ConsentProvider>` below shares the existing store (one decision per page);
    an explicit `<AnalyticsProvider>` below joins the existing hub of the same
    shop instead of loading the pixels twice (a different shop gets its own hub). New `<ConsentSettingsButton>` (a localized "Cookie settings"
    button that reopens the banner).
  - **Server** — `ShopkitConfig.consent` (`{ revision, cookieName }` or
    `false`) is the one place the policy revision lives;
    `shopkit.consent.read()` returns the decision from the client's cookies.
    `checkout.start()` on a client with a `cookies` accessor forwards the
    decision on the hosted checkout URL itself, plus the GA client and session
    ids when the accessor has the new optional `getAll()` (Next's
    `jar.getAll()`). `appendCheckoutHandoffParams` stays exported, accepts a
    cookie list, and is idempotent.
  - **Thank-you page** — `useOrderConfirmation(id, { initialConfirmation })`
    settles from the server's snapshot without polling, forgets the bought cart
    and session (`finalize()`, as a completed poll does) and fires the
    `purchase` from it, deduplicated with the polling path, so `useTrackPurchase` is no
    longer needed there (it stays exported).
  - **Google waits for consent** — `googleTagDestination`'s `loadBeforeConsent`
    now defaults to false. `loadBeforeConsent: true` (`consent={{ analytics: {
loadBeforeConsent: true } }}`, `configure({ analytics: { loadBeforeConsent:
true } })`, `data-analytics-load-before-consent`) loads GTM / gtag.js in
    Consent Mode denied before a decision; a GTM container then runs all of its
    tags.
  - **Currencies** — events carry the currency their amounts are in:
    `view_item` the product's own, the cart events the cart's, `purchase` the
    one the checkout charged; a server-started checkout sends the chosen
    currency in the handoff body and the consent on the URL.
  - **Meta consent API** — the pixel calls `fbq("consent", "grant")` before
    `init` and `grant` / `revoke` on every later change.
  - **Styled default banner** — one stylesheet, shared by `<ConsentBanner>` and
    `<qb-consent-banner>`, in `@layer qb-consent` so the site's own CSS always
    wins, themed through `--qb-consent-*` custom properties, light and dark,
    mobile sheet layout; `unstyled` leaves it out. Exported as
    `CONSENT_STYLES` / `injectConsentStyles()`.
  - **Consent** — `ConsentStore` (subscribe/getSnapshot like the cart store;
    `acceptAll`, `rejectAll`, `save`, `reset`, `allows`, `openSettings`), the
    `qb_consent` cookie (180 days, revisioned, server-readable through
    `readConsentCookie`), Google Consent Mode v2 signals
    (`consentModeSignals`), built-in banner copy in en/sv/da/nb/fi
    (`consentLabels`), and a `qb:consent` document event on every decision.
    Categories are the platform's three: `necessary`, `analytics`, `marketing`.
    Undecided is denied.
  - **Analytics** — the `Analytics` hub fans GA4-shaped `CommerceEvent`s out to
    destinations gated on consent, remembers events a destination cannot take
    yet (consent pending, shop ids loading) and drops them on denial,
    deduplicates the purchase through the platform's own
    `qb_purchase_tracked_{storeId}_{orderNumber}` key and carries Meta's
    `purchase_{storeId}_{orderNumber}` eventID (the store id learned from the
    attached cart when not given). Destinations:
    `googleTagDestination` (gtag.js / GTM / Ads, Consent Mode `default` pushed
    before any script, `update` on every change), `metaPixelDestination`
    (hard-gated on marketing), `destinationsFromShop(shop.tracking)`, and the
    `AnalyticsDestination` interface for your own. Pure mappers:
    `viewItemEvent`, `searchEvent`, `viewItemListEvent`, `itemsFromCart`,
    `cartLineDiff`, `purchaseFromSession`, `toMajorUnits`.
  - **React pieces** — `<ConsentProvider>`, `useConsent` / `useOptionalConsent`,
    `<ConsentBanner>` (render-prop, or the default dialog when given no
    children), `<ConsentGate>`, `<AnalyticsProvider>` (`auto` reads the shop's
    ids), `useAnalytics` / `useOptionalAnalytics`, `useTrackPurchase`;
    `useOrderConfirmation` tracks the purchase in redirect mode
    (`trackPurchase: false` to opt out); `view_item`, `search`,
    `add_to_cart` / `remove_from_cart` and the embedded checkout's events are
    tracked automatically; `useCheckout` forwards the decision to the hosted
    checkout (`consentCategories`, `gaClientId`, `gaSessionId`).
  - **Elements** — `<qb-consent-banner>` (auto-mounted on a configured page
    unless the page places its own, which always wins), `<qb-consent-settings>`
    (renders a localized button when empty), `<qb-consent-gate>`;
    `configure({ consent, analytics })` (both on by default; `consent` takes the
    store options plus `lang`, `privacyPolicyUrl`, `banner`, `unstyled`) and
    `<qb-shop consent analytics privacy-policy-url>` (a `<qb-shop>` for the same
    shop as the page reuses the page's hub); `<qb-order-confirmation>` tracks
    the purchase (`no-track-purchase` to opt out); every handoff element
    forwards the decision. Script tag: `data-consent="false"`,
    `data-analytics="false"`, `data-analytics-require-consent`,
    `data-consent-lang`, `data-privacy-policy-url`, `data-consent-banner`,
    `data-consent-unstyled`, `data-consent-revision` / `-cookie` / `-domain` /
    `-max-age-days`; `Quickbutik.consent`, `Quickbutik.analytics`,
    `Quickbutik.track()`.
  - **SDK** — `Shop.tracking` (`ga4MeasurementId`, `gtmContainerId`,
    `metaPixelId`, `metaCapiEnabled`) is now typed;
    `checkout.rememberedStoreId()`; `CartStore.onMutation()` reports every
    successful mutation with the cart before and after;
    `Analytics.observeCart()`, `Analytics.removeDestination()`, and an optional
    `AnalyticsDestination.key` (which account it reports to; the built-ins use
    their ids, custom destinations default to object identity) that lets an
    inline `destinations` array keep a destination across renders without
    replaying events into it. The shop's numeric store id noted off the cart is
    now kept whenever the cart is forgotten (`checkout.finalize()`, a cart the
    platform has dropped, `cart.clear()`), so a reloaded thank-you page builds
    the same purchase dedup key as the first visit.

  The script-tag bundle's gzip budget is raised to make room for the consent and
  analytics code (about 48.9 KB of the 50.8 KB budget).

- f974752: Multi-currency storefronts.

  - **SDK.** `createShopkitClient({ currency: "EUR" })` sets the currency a
    client browses in; `client.currency`, `client.setCurrency(code | null)` (the
    choice is remembered under `${storageKeyPrefix}_currency`, so a server render
    with request-cookie storage sees it) and `client.onCurrencyChange()`. Every
    product read and cart request then carries `?currency=`, and every checkout
    session and handoff carries `currency` in its body (`currency` per call on
    product reads and `CreateSessionInput` overrides it, `null` sends none). With
    no currency nothing is sent and everything stays in the shop's currency.
  - **Types.** `Product.currency`, `Cart.presentment` (`mode`, `chargeCurrency`,
    `baseCurrency`, `exchangeRate`), `Shop.currency` / `Shop.currencies`
    (`ShopCurrency { code, mode: "base" | "display" | "charge", rate }`),
    `CheckoutSession.displayCurrency`, and `baseCurrency` / `exchangeRate` on
    `CheckoutPricing`. `describeCurrency(shop, code)` resolves a choice the way
    the platform does; `getShopPromise(client)` shares one shop read per client.
  - **State.** The product cache keys on the currency, and `CartStore` re-reads
    the same cart when the currency changes.
  - **React.** `<ShopkitProvider currency>`, `useCurrency()` (`currency`,
    `currencies`, `mode`, `chargeCurrency`, `setCurrency`, `isLoading`) and
    `useClientCurrency(client)`. Catalog hooks and `<ProductProvider slug|id>`
    refetch on a switch; `useProductPrice().currency` is the product's own.
  - **Elements.** New `<qb-currency-select>` (a native `<select>`, your own
    `<select>`, or a `<template>` with `data-qb-action="set-currency"`), and
    `setCurrency()` next to `configure()`. `<qb-product>` and `<qb-product-list>`
    reload on a currency change, also on the ambient shop; `<qb-shop currency>`
    now drives fetching, and changing it switches the client without rebuilding
    it. Prices format with the response's own currency.
  - **Script tag.** `data-currency` is the starting currency;
    `Quickbutik.currency`, `Quickbutik.setCurrency()`,
    `Quickbutik.onCurrencyChange()`, `Quickbutik.describeCurrency()`.

  Behaviour change: `configure({ currency })` / `data-currency` used to be a
  formatting setting only, and is now also sent with every request. For the
  shop's own currency (the common setup) the platform answers exactly as before.
  The script-tag size budget is raised from 38 000 to 42 000 gzipped bytes
  (~40.1 KB now) for the currency support.

## 1.7.0

### Minor Changes

- 0242f1b: `buildSeo({ category })` names the parent entries of its `BreadcrumbList` from `Category.ancestors` instead of recovering them from the slug path.

  A parent category named "Kläder" with the slug `klader` used to appear as "Klader" in structured data. It now appears as "Kläder". A parent with no name is still labelled from its slug (`winter-jackets` reads as `Winter jackets`). The shape of the trail and its URLs are unchanged: one entry per segment of `path`, with the page's own URL on the last entry.

  ```ts
  // category.ancestors: [{ id: "cat_2", name: "Kläder", slug: "klader" }]
  // category.path: "klader/skjortor"
  const tags = buildSeo({
    category,
    url: "/c/skjortor",
    baseUrl: "https://myshop.com",
  });
  // BreadcrumbList: "Kläder", then "Skjortor" at https://myshop.com/c/skjortor
  ```

  Nothing to change in your code. Pages that pass explicit `breadcrumbs` are not affected.

## 1.6.0

### Minor Changes

- 3936a33: `Category.ancestors` is now typed as `CategoryAncestor[]` instead of `string[]`.

  The API has always returned an object per ancestor, ordered root to immediate parent, so this corrects the type to match what arrives at runtime. Nothing changes at runtime.

  ```ts
  interface CategoryAncestor {
    id: string; // "cat_2"
    name: string | null;
    slug: string | null; // the ancestor's own slug segment
  }

  const category = await shopkit.categories.get("cat_14");
  if (category) {
    const trail = [...category.ancestors, category].map(
      (c) => c.name ?? c.slug,
    );
  }
  ```

  `CategoryAncestor` is exported from `@quickbutik/kit` and `@quickbutik/kit/sdk`.

  If your code typed `ancestors` entries as strings (for example `ancestors.includes("cat_2")`, or a fixture with `ancestors: ["cat_2"]`), it will now fail to compile. Read `ancestor.id` for the id, or use `name` and `slug` directly to build a breadcrumb without extra requests.

## 1.5.0

### Minor Changes

- 42af60d: Variant images, content sections and related products on `Product`.

  ```ts
  const product = await shopkit.products.get("prod_27");

  // The picked variant's own image, else the main one.
  const image =
    pickProductImage(product, { imageId: variant.imageId ?? undefined }) ??
    pickProductImage(product);

  // The merchant's content sections, in their order. `content` is HTML.
  for (const section of product.sections ?? [])
    render(section.title, section.content);

  // Related products (products.get only): "category" | "specific" | "none".
  product.relatedProducts?.products; // [{ id, name, slug, price, image }]
  ```

  - `ProductVariant.imageId?: number | null` — the id of one of the product's
    `images`, or null.
  - `Product.sections?: ProductSection[]` — `{ id, title, content }`, rendered as
    the Quickbutik theme renders them: template-linked sections carry the
    template's text and the `[STOCKLEFT]` / `[PRICE]` / `[BEFOREPRICE]` merge tags
    are replaced.
  - `Product.relatedProducts?: RelatedProducts` — `{ mode, products }`, served
    only by `products.get()`. Cards are priced like the product list, automatic
    discounts and `storefrontId` campaign prices included.

  New exported types: `ProductSection`, `RelatedProducts`,
  `RelatedProductSummary`, `RelatedProductsMode`. Every new field is optional, so
  existing code and fixtures keep compiling, and a response from an API that
  predates them still type-checks.

## 1.4.0

### Minor Changes

- 14873cd: "Köp nu", campaign-priced catalogs, and a one-call "empty the cart".

  **Buy now, in every layer.** `checkout.buyNow()` has been in the SDK; the UI
  layers now wrap it and navigate:

  ```tsx
  const { buyNow } = useCheckout();
  buyNow({ productId, variantId }, { successUrl: `${origin}/order` });

  // inside <ProductProvider>, with the selected variant and the selection guard
  const { buyNow, buying, buyNowError } = useProductAddToCart();
  ```

  ```html
  <qb-product slug="cotton-tee">
    <qb-buy-now success-url="/order" back-url="/p/cotton-tee"
      ><button>Köp nu</button></qb-buy-now
    >
    <!-- or on a plain button: -->
    <button data-qb-action="buy-now" data-qb-success-url="/order">
      Köp nu
    </button>
  </qb-product>
  ```

  `<qb-buy-now>` takes the same `success-url` / `back-url` / `theme` /
  `no-redirect` / `disabled` attributes as `<qb-checkout-button>`, resolved by the
  same code, and emits `qb:checkout-started`. Both go through the shared
  `CartStore` (new `CartStore.buyNow()`), so a badge on a page the shopper comes
  back to is not one item short. `checkout.buyNow()` now also returns `cart`, and
  checks `successUrl` before adding anything. After a navigating buy-now the
  button stays busy until the page is restored from the back/forward cache, so a
  click while the checkout loads cannot add the item twice. This also changes the
  existing `<qb-checkout-button>` and `useCheckout().redirectToCheckout()`: they
  now stay pending (`pending` attribute, `starting`) after navigating too, instead
  of clearing as soon as `location.assign()` returns. A navigation that never
  unloads the page (a "Stay" on a leave-page prompt, a 204 or download response,
  a blocked navigation) releases the busy state after 10 seconds.

  **`storefrontId`: sell into a campaign storefront by id.** `ShopkitConfig.storefrontId`
  is shorthand for `storefront: { id }`; both may be given only when they agree.
  It is also `<ShopkitProvider storefrontId>` (rebuilds the client when it
  changes; a prebuilt `client` bound elsewhere throws), `<qb-shop storefront-id>`,
  the script tag's `data-storefront-id` and `configure({ storefrontId })`.

  **Product reads are priced for the campaign.** A bound client sends
  `storefrontId` on `products.list()`, `search()` and `get()` (so also
  `getBySlug()`, `listAll()`, the catalog hooks and `<qb-product>`), so the
  catalog shows the price the cart will charge. Any read can name another
  campaign per call, or pass `storefrontId: null` for the shop's ordinary prices;
  the product promise cache keys a per-call campaign separately. An unbound
  client sends exactly the request it always has.

  **`cart.clear()`.** Deletes the remembered cart and forgets it; a 404/410 still
  forgets it, and with no cart it makes no request. `CartStore.clear()` now goes
  through it (deleting the cart on screen when storage remembers none, via the new
  `fallbackCartId` option), and it is also `useCart().clearCart` (alias of `clear`),
  `data-qb-action="clear-cart"` inside `<qb-cart>`, and `Quickbutik.clearCart()`.

  **Legacy checkout docs.** The platform now returns legacy-checkout shoppers to
  `<successUrl origin>/success/<orderNumber>?t=…&hash=…`, the same as checkout-v2,
  and its back links go to `backUrl`. `LegacyHandoff` and the checkout guide no
  longer say the handoff is terminal; `parseReturnUrl()` and
  `pollConfirmation(legacyOrderUuid)` already handle the return, so no code change
  is needed.

## 1.3.0

### Minor Changes

- 156e6cd: Campaign storefronts on the cart and the checkout, and inline success mode.

  - `ShopkitConfig.storefront: { id, surface? } | null` binds a client to one campaign storefront; `client.storefront` exposes the resolved binding. The id is validated (`sf_` + 26 Crockford base32 characters) and `surface` against the exported `STOREFRONT_SURFACES` (`hosted | link | embed | shopkit | agentic`, default `shopkit`); a bad value throws `ShopkitConfigError`.
  - `cart.create()` accepts `{ storefrontId, surface }` and posts them so the cart is created bound to the campaign; `Cart` gains `storefrontId` and `surface` (optional-null). On a bound client `ensure()` / `add()` create bound carts.
  - `checkout.createSession()`, `checkout.start()` and `buyNow()` accept `storefrontId` / `surface` and send both on `/checkout/sessions` and `/checkout/handoff`, falling back to the client's binding. With no storefront from either source nothing new is sent.
  - Per-call rule: a call that reuses the remembered cart (`cart.ensure()`, `cart.add()`, `start()` / `buyNow()` without `cartId`) accepts a `storefrontId` only when it equals the client's binding; anything else throws `ShopkitConfigError` before any request, naming the two supported patterns (bind the client, or `cart.create({ storefrontId })` and pass `cartId`). Stateless calls may name any campaign.
  - A bound client defaults `storageKeyPrefix` to `qb_<id lower-cased>` so a campaign cart never shares a cookie with the shop's ordinary cart. Adding `storefront` to an existing integration therefore changes the prefix; pass `storageKeyPrefix: "qb"` to keep previously remembered carts.
  - `storefrontRefusal(error)` decodes the platform's typed refusals by `details.reason` (`storefront_not_live` with `effectiveState`; `storefront_quantity_limit` with `limitType`, `productId`, `variantId`, `maxQuantity`; `storefront_mismatch` with `cartStorefrontId`) and is `null` for anything else. Exported with `StorefrontRefusal`, `StorefrontSurface`, `StorefrontBinding`, `StorefrontAttribution`, `isStorefrontId`, `isStorefrontSurface`, `DEFAULT_STOREFRONT_SURFACE` and `STOREFRONT_ID_PATTERN` from the root and `/sdk` entries (and on the script-tag global).
  - `successMode?: "redirect" | "inline"` on `CreateSessionInput` / `StartCheckoutInput` (exported as `SuccessMode` + `SUCCESS_MODES`). In `inline` mode the hosted checkout shows the order confirmation itself and never redirects, so `successUrl` is now optional on the input types; a redirect session without one throws `ShopkitConfigError` at runtime before any request. `successMode` is sent only when set and is typed on `CheckoutSession`, `CheckoutSessionSnapshot` and `SessionConfirmation`. `docs/checkout.md` gains an "Inline confirmation" pattern: in inline mode `parseReturnUrl()` never fires and completion is learned only via `confirmation()` / `pollConfirmation()`. Because the platform answers such a session with `successUrl: null`, `CheckoutSession.successUrl` and `CheckoutSessionSnapshot.successUrl` (and so the `start()` handoff) are now typed `string | null`.
  - Build: the four module entries (`.`, `/sdk`, `/react`, `/elements`) are now built in one tsup config with shared chunks. Previously each entry bundled its own copy of the SDK, so a `ShopkitClient` from `@quickbutik/kit` was not assignable to `ShopkitProvider`'s `client` prop from `@quickbutik/kit/react` (nominal class declared twice), and errors thrown by a provider-created client failed `instanceof ShopkitApiError` from the root entry. A post-build guard (`scripts/check-entries.mjs`) now type-checks a cross-entry consumer and compares the classes by identity on every build.

## 1.2.1

### Patch Changes

- a1665bc: `<Checkout>` and `<qb-checkout>` take the checkout theme, and so does
  `<qb-checkout-button>`. The SDK has had `theme` since 1.2.0, but the components
  did not pass it on, so the only way to put a dark checkout on a dark page was to
  drop down to `checkout.mount()` by hand.

  ```tsx
  <Checkout successUrl="/thanks" theme="dark" />
  ```

  ```html
  <qb-checkout success-url="/thanks" theme="dark"></qb-checkout>
  <qb-checkout-button success-url="/order" theme="dark">…</qb-checkout-button>
  ```

  Same rule as the SDK option: omitting it is not the same as passing `"light"`.
  Omit it and the checkout follows the theme the merchant chose for their shop,
  and keeps following it; name one and this checkout is pinned to it. The frame is
  a document of its own and inherits nothing from the page's CSS, so a dark
  storefront has to say so.

  Read once, when the session is created, alongside `successUrl` and `lang` — a
  page that flips its own dark mode under a live checkout does not repaint the
  frame, because rebuilding the session would discard a payment the shopper may be
  halfway through.

  A value that is neither `light` nor `dark` is dropped with a console warning
  rather than forwarded: the platform would reject the whole session over it, and
  no shopper should lose their checkout to a presentation detail.

## 1.2.0

### Minor Changes

- 9ad5f39: Checkouts can be dark, chosen by the shop or by the session. `createSession`,
  `start` and `mount` take a `theme` of `"light"` or `"dark"`, and the session
  reports back the theme the shopper will actually see.

  Omitting `theme` is not the same as passing `"light"`. Omit it and the checkout
  follows the theme the merchant chose for their shop, which they can now set
  alongside the rest of their checkout customizations. Pass `"light"` and this
  checkout stays light whatever the merchant chose — set it when your own pages
  are light and you do not want the shop setting reaching them. Pass `"dark"` for
  the reverse.

  Chosen per shop or per session rather than from the shopper's
  `prefers-color-scheme`: the checkout is the last screen of your shop and has to
  match the page the shopper came from, so a light storefront whose visitor runs a
  dark OS still hands them a light checkout.

  A session's own `theme` is fixed when the session is created and cannot be
  changed afterwards. The shop's theme is not: if you omit `theme`, a merchant
  changing it applies immediately, including to a checkout a shopper already has
  open.

## 1.1.1

### Patch Changes

- 2545e51: Embedded checkout: the frame no longer adds a gap or a ground of its own.

  The iframe `mount()` creates is now `display: block` with an explicitly
  transparent background. An iframe is `inline` by default, so it sat on the text
  baseline and left a few pixels of descender space underneath it that read as a
  stray margin below the checkout — visible on any page that puts the checkout
  directly above something else, and not removable from the merchant's side
  without knowing why it was there. The transparent background states what the
  checkout document already does, so a stylesheet with a blanket
  `iframe { background: #fff }` cannot paint an opaque rectangle over the ground
  the page chose.

  Paired with the checkout itself going full-bleed inside the frame: the page
  gutter and the content width cap are dropped in embed mode, so the checkout
  fills whatever box the merchant sizes the frame into and the merchant's own
  padding is the only padding.

## 1.1.0

### Minor Changes

- d817092: Embedded checkout: render the hosted checkout **inside the merchant's own page**
  instead of sending the shopper away.

  ```html
  <qb-checkout success-url="/thanks" back-url="/cart" lang="sv"></qb-checkout>
  ```

  ```ts
  const checkout = await shopkit.checkout.mount("#checkout", {
    successUrl: "/thanks",
  });
  checkout.on("complete", ({ orderNumber }) => track(orderNumber));
  ```

  ```tsx
  <Checkout successUrl="/thanks" onComplete={celebrate} />
  ```

  The frame is served from the checkout's own origin, so the PSP integration,
  3-D Secure, the API proxy and the wallet domain registrations are untouched —
  the same checkout, in a different window. `mount()` costs what `start()` costs:
  one `POST /checkout/handoff`, with an `embed` block added.

  - **Who may frame a checkout is recorded on the session**, by the same call that
    already chooses `successUrl`; the checkout serves the embed document with
    `frame-ancestors` naming that one origin. A hand-built iframe around a hosted
    checkout URL is refused, and always will be — `mount()` is the way in.
  - **Redirect payment methods break out to the top window.** Klarna, Swish,
    Vipps/MobilePay, iDEAL, Trustly and a full-page 3-D Secure cannot complete
    inside a frame: the frame asks, the kit navigates, and the provider returns the
    shopper to the page with
    `?qb_checkout_session=<id>&qb_checkout_shop=<numeric shop id>`, which
    `<qb-checkout>` and `<Checkout>` resume automatically and strip from the
    address bar once the resumed frame has answered. **The page that mounts the
    checkout must tolerate both parameters.** The shop id rides the URL because
    the resume has to build `/embed/{storeId}/{sessionId}` with no storage at
    all: the kit remembers the store id next to the cart id, and the platform
    drops the cart the moment the order exists, which on a redirect payment is
    normally before the shopper is back. A bounce carrying the session parameter
    alone still resumes wherever the id is known locally, because the store id is
    now remembered a second time next to the checkout session
    (`<prefix>_checkout_store`), for as long as that session lives.
  - **The embedded checkout follows the cart.** Nothing is mounted for an empty
    cart (`qb:checkout-empty`, and the new `onEmpty` prop on `<Checkout>`, once
    per empty phase) and the frame goes in by itself when items exist, so
    rendering `<Checkout>` with an empty cart is no longer a fatal error.
    Emptying the cart from the page under a mounted checkout takes the frame down
    and the next item added starts a fresh session, instead of leaving a frame
    bound to a cart that no longer exists; a frame resuming a return leg or
    showing a completed order is left alone, because there the cart is supposed
    to be gone. Changing the cart without emptying it updates the checkout in
    place: the lines, totals, shipping options and amount to pay follow, with no
    merchant code at all for `<qb-checkout>` and `<Checkout>`, which do it off the
    kit's own cart store. A host that drives `mount()` by hand tells the frame
    with the new `EmbeddedCheckout.cartUpdated()`.
  - **It degrades instead of stranding anyone.** A shop on the legacy checkout, a
    platform with no embed URL for the shop, and a page that cannot navigate its
    own top window (an AI site builder's preview pane) each resolve to a handle in
    a `fallback` state, emit `qb:checkout-fallback`, and send the shopper to the
    hosted checkout. None of the three throws. A frame that is built but never
    answers within 15 seconds (the page is not the origin the session was created
    for, typically) is taken down and falls back the same way, with reason
    `handshake-timeout` and the hosted URL of the same session, on `mount()` and
    `resume()` alike, instead of stranding the shopper on an empty box.
  - Not in the embed yet: wallets (off inside the frame; it already carries
    `allow="payment"`, so enabling them later needs no merchant change) and
    merchant pixels inside the frame (commerce events are forwarded to the page as
    `event` instead, for its own `dataLayer`).

  New surface: `checkout.mount()`, `checkout.resume()` (which takes `storeId`),
  `checkout.embedUrl()`, `<qb-checkout>`, React `<Checkout>` (with `onEmpty`), an
  optional `embed` input plus `embedUrl` on `checkout.start()`, the return-leg
  helpers for a host that routes the parameters itself (`readReturnedCheckout()`,
  `readReturnedSessionId()`, `stripReturnedSessionId()`,
  `consumeReturnedSessionId()`, `CHECKOUT_SESSION_PARAM`, `CHECKOUT_SHOP_PARAM`),
  `EmbeddedCheckout.cartUpdated()` with the `revision` counter on the cart
  snapshot that drives it,
  and the message contract itself (`parseEmbedFrameMessage`, `isSafeNavigationUrl`,
  `EMBED_MESSAGE_SOURCE`, `EMBED_MESSAGE_VERSION`) for a host built by hand.

  The script-tag build grows from ~28 KB to ~33 KB gzipped and is now checked
  against a size budget on every build.

## 1.0.1

### Patch Changes

- e7607c3: `DEFAULT_CHECKOUT_URL` is now `https://pay.quickbutik.com`: the hosted checkout moved from `checkout-v2.quickbutik.com` to `pay.quickbutik.com`. The constant is only the last-resort fallback for the checkout-v2 flavour; `checkout.start()` keeps using the URL the platform returns, so a shop's handoff follows the platform's configured host regardless of the kit version.

## 1.0.0

First public release. `@quickbutik/kit` is on npm, under MIT — installing it no
longer needs a registry, an `.npmrc` or a token:

```bash
npm install @quickbutik/kit
```

A bring-your-own-frontend storefront SDK: build a shop on any JavaScript stack
(Next.js, TanStack Start, Astro, a plain SPA, or a page with no bundler at all)
with Quickbutik as the commerce engine, authenticated by a shop's publishable key
(`qb_pk_…`) and its scopes. It has no runtime dependencies. React is an optional
peer dependency (`^18.2 || ^19`), needed only for `/react`.

### Entry points

- **`@quickbutik/kit`** — `createShopkitClient()`, every type, the isomorphic
  storage adapters, and the framework-free core: `ProductController`,
  `buildVariantMatrix`, `resolveVariant`, `buildPriceState`, `buildSeo`,
  `AsyncResource`, `formatMoney` / `formatMoneyRange`.
- **`@quickbutik/kit/sdk`** — the API surface on its own: products, categories,
  cart, checkout, shop.
- **`@quickbutik/kit/react`** — `ShopkitProvider` plus `useCart`, `useProducts`,
  `useProduct`, `useCategories`, `useShop`, `useCheckout` and
  `useOrderConfirmation`.
- **`@quickbutik/kit/elements`** — custom elements: `<qb-product>`,
  `<qb-options>`, `<qb-option-values>`, `<qb-add-to-cart>`, `<qb-product-list>`,
  `<qb-product-image>`, `<qb-cart>`, `<qb-cart-items>`, `<qb-cart-count>`,
  `<qb-checkout-button>`, `<qb-order-confirmation>`, `<qb-seo>` and an optional
  `<qb-shop>`. Light DOM only, no shadow root, and no markup of their own (bar
  the one `<img>`): they bind into the markup you wrote via `data-qb-text` /
  `-html` / `-attr` / `-class` / `-show` / `-hide` / `-value`, act on
  `data-qb-action`, and reflect their state as attributes for CSS. Registration
  is explicit and idempotent — `defineElements()`, optionally with a `prefix`.
- **`@quickbutik/kit/global`** (`dist/quickbutik-kit.global.js`) — one
  self-contained IIFE, ~28 KB gzipped, for a page with no npm or bundler. It
  reads `data-publishable-key`, `data-currency`, … off its own script tag,
  configures the shop, registers the elements, and exposes `window.Quickbutik`.

**The shop is ambient.** `configure({ publishableKey })` — or the script tag's
attributes — sets up one client and one shared cart store for the page, and every
element finds it. There is no required provider element; `<qb-shop>` exists only
for two shops on one page, a subtree on a different gateway, or a client you
built yourself.

### Variants, headless in both worlds

One implementation drives React and the elements alike. `ProductController` is
the variant-selection state machine with no framework attached;
`<ProductProvider>` is a `useSyncExternalStore` over it, and `<qb-product>`
subscribes to it directly. Availability is computed per option value against the
OTHER groups' choices, so a non-rectangular matrix (a colour that lacks one size)
narrows correctly in both directions, and a contradicting click repairs the
selection instead of dead-ending — which is also why unavailable values stay
clickable rather than disabled. `<qb-options>` names no option type: it repeats
per option group the product actually has, so one template serves a three-option
product, a one-option product and a product with none.

The React render-prop components (`ProductOptions`, `ProductOptionGroup`,
`ProductOptionValues`, `SelectedVariant`, `ProductPrice`, `AddToCart`) emit **no
markup at all** — every element, class and style belongs to the app.
`ProductProvider` resolves the product itself: pass a resolved object, a promise
for one, or just a `slug`/`id`, unwrapped with React 19's `use()` so `<Suspense>`
handles the wait. Lookup promises are cached per (client, slug), which is a
requirement rather than an optimization — suspending on a freshly created promise
never terminates.

### Checkout

`checkout.start()` (and `buyNow()`) ask the platform for the handoff via
`POST /v2/checkout/handoff` rather than building a URL locally, so the SDK follows
whichever checkout the shop actually runs. `StartCheckoutResult` is a union
discriminated on `checkout`: the `v2` arm carries a `session`, the `legacy` arm a
`legacyOrderUuid` and no session. `url` is on both, so a button that only
navigates needs no narrowing, and so is `handoffId` — the handle
`checkout.confirmation()` polls, which accepts either kind.

Three things to know before pointing a headless storefront at a legacy shop: the
shopper is returned to the shop's own platform storefront rather than your
`successUrl` (that checkout's redirect cannot be pointed elsewhere, so
`parseReturnUrl()` never fires), a failed payment reads as `no_attempt` rather
than `failed`, and cart campaign or säljplats override prices do not survive —
the legacy checkout re-prices every line from the catalog.

`start()` refuses to guess: when the platform reports no host configured for a
shop it throws rather than fall back to the production host, which would send a
staging or local shopper to production checkout. Session creation is idempotent on
`cartId` server-side, so `createSession()` compares the session's cart snapshot
against the live cart and rehydrates only when they differ — a shopper who leaves
checkout, adds a line and sets off again no longer gets the first session with the
new lines missing. `checkout.syncCart(sessionId)` does the same on demand.

Defaults: `https://commerce.quickbutik.com` for the API and
`https://checkout-v2.quickbutik.com` for checkout.

### SEO

`buildSeo(...)` is framework-free and produces titles (preferring the merchant's
`seoTitle` / `seoDescription`, which nothing headless read before), canonical
URLs, OpenGraph, Twitter cards and schema.org structured data — `Product` with
`Offer`/`AggregateOffer` carrying price and availability, `BreadcrumbList`,
`Organization`. `<SEO />` and `<JsonLd />` render it in React, `<qb-seo>` in HTML.
