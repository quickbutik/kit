import { canNavigateTopWindow } from "../../runtime/detect.js";
import type { SessionStore } from "../../state/session-store.js";
import type { ResolvedShopkitConfig } from "../config.js";
import { type CurrencyPreference, normalizeCurrency } from "../currency.js";
import {
	EmbeddedCheckout,
	type EmbeddedCheckoutFallbackReason,
	type EmbedRenderOptions,
} from "../embed/bridge.js";
import { isSafeNavigationUrl } from "../embed/messages.js";
import {
	CHECKOUT_SESSION_PARAM,
	CHECKOUT_SHOP_PARAM,
} from "../embed/return-leg.js";
import { ShopkitConfigError } from "../errors.js";
import { linePropertiesKey } from "../line-properties.js";
import type { ScopeGuard } from "../scopes.js";
import {
	assertRememberingCallBinding,
	resolveStorefrontAttribution,
} from "../storefront.js";
import type { Transport } from "../transport.js";
import type { AddCartItemInput, Cart, CartItem } from "../types/cart.js";
import type {
	CheckoutFlavour,
	CheckoutHandoff,
	CheckoutSession,
	CheckoutSessionSnapshot,
	ConfirmationOutcome,
	ConfirmationStatus,
	CreateSessionInput,
	HostedCheckoutReturn,
	HostedCheckoutUrlInput,
	PatchResult,
	PollConfirmationOptions,
	SessionConfirmation,
	SessionEmbed,
	SessionFieldMap,
} from "../types/checkout.js";
import { SUCCESS_MODES } from "../types/checkout.js";
import type { RequestOptions } from "../types/common.js";
import type { CartResource } from "./cart.js";
import type { ConsentResource } from "./consent.js";

/**
 * Delay before poll N+1, plateauing at the last entry. Front-loaded because
 * order creation usually lands in 6–17s.
 */
const CONFIRMATION_BACKOFF_MS: readonly number[] = [
	1000, 1500, 1500, 2000, 2000, 3000, 3000, 5000,
];
const DEFAULT_MAX_POLLS = 20;
const DEFAULT_MAX_TOTAL_MS = 90_000;
/** Ceiling on a server-supplied delay, so a bad value cannot stall the page. */
const RETRY_AFTER_CAP_MS = 15_000;

/**
 * Input to `checkout.start()`: a `CreateSessionInput` whose cart is optional.
 * The `successUrl` rule is the same — required unless `successMode: "inline"`.
 */
export interface StartCheckoutInput extends Omit<CreateSessionInput, "cartId"> {
	/** Defaults to the remembered cart (created if this visitor has none). */
	cartId?: string;
}

export interface MountCheckoutInput
	extends StartCheckoutInput,
		EmbedRenderOptions {
	/**
	 * The origin recorded on the session as the only one allowed to frame it.
	 * Defaults to this page's. Override only when the page creating the session
	 * is not the page that will show it.
	 */
	embedOrigin?: string;
	/**
	 * Where a redirect payment method returns the shopper. Defaults to this
	 * page's URL without the kit's own return parameters. Must share an origin
	 * with `embedOrigin`.
	 */
	returnUrl?: string;
}

export interface ResumeCheckoutInput extends EmbedRenderOptions {
	/**
	 * The shop's numeric id, as carried on the return URL
	 * (`readReturnedCheckout().storeId`). When omitted, the id remembered with
	 * the checkout session or the last cart is used.
	 */
	storeId?: string | number | null;
	language?: string;
	/** Where a completed order lands, as on {@link MountCheckoutInput}. */
	successUrl?: string;
}

/**
 * Where to send the shopper, and which checkout answered.
 *
 * `url` is present on both arms, and both return the shopper to
 * `<successUrl origin>/success/<orderNumber>` after paying, so a plain
 * "Checkout" button needs no branching. Branch on `checkout` when the
 * difference matters: a `legacy` handoff has no session to read or patch, and
 * confirms by `legacyOrderUuid`. See {@link CheckoutFlavour}.
 */
export type StartCheckoutResult = {
	/** Send the shopper here — a top-level navigation, not a fetch. */
	url: string;
	checkout: CheckoutFlavour;
	/**
	 * The handle to poll {@link CheckoutResource.confirmation} with: the session
	 * id on `v2`, the legacy order uuid on `legacy`.
	 */
	handoffId: string;
	cartId: string;
	/**
	 * Where to frame the checkout, for a caller doing its own embedding. Null
	 * when no `embed` was requested, the shop is on the legacy checkout, or the
	 * platform has no embed URL for it. Prefer {@link CheckoutResource.mount}.
	 */
	embedUrl: string | null;
} & (
	| {
			checkout: "v2";
			session: CheckoutSession;
			legacyOrderUuid?: undefined;
	  }
	| {
			checkout: "legacy";
			/** A legacy handoff creates an unpaid order, not a session. */
			session?: undefined;
			legacyOrderUuid: string;
	  }
);

/**
 * What `checkout.buyNow()` resolves to: the {@link StartCheckoutResult} of the
 * handoff, plus the cart the checkout was started from.
 */
export type BuyNowResult = StartCheckoutResult & {
	/** The remembered cart after the item was added. */
	cart: Cart;
};

/**
 * Checkout, as a headless storefront uses it: build a session from a cart, hand
 * the shopper to the hosted Quickbutik checkout, then confirm the order when
 * they come back.
 *
 * Payment is not part of this surface: the hosted checkout owns the PSP
 * integration, PCI scope, 3-D Secure, wallets and payment retries.
 */
export class CheckoutResource {
	constructor(
		private readonly transport: Transport,
		private readonly scopes: ScopeGuard,
		private readonly store: SessionStore,
		private readonly config: ResolvedShopkitConfig,
		private readonly cart: CartResource,
		private readonly currency: CurrencyPreference | null = null,
		private readonly consent?: ConsentResource,
	) {}

	// Sessions

	/**
	 * Create a checkout session for a cart and remember it.
	 *
	 * `successUrl`, `cancelUrl` and `backUrl` must be `https` (`http` only for
	 * localhost/loopback); see {@link CreateSessionInput.successUrl}. Only the
	 * origin of `successUrl` is used for the return redirect.
	 *
	 * A campaign storefront (`storefrontId` on the input, else the client's
	 * `storefront`) prices the session; a campaign that is not live, an
	 * exceeded quantity limit or a cart bound to another campaign is refused
	 * with a typed error (see `storefrontRefusal()`).
	 */
	async createSession(
		input: CreateSessionInput,
		options: RequestOptions & { cart?: Cart } = {},
	): Promise<CheckoutSession> {
		assertSuccessTarget(input, "checkout.createSession()");
		this.scopes.assert("checkout:write", "checkout.createSession()");
		const session = await this.transport.request<CheckoutSession>({
			method: "POST",
			path: "/checkout/sessions",
			body: await this.sessionBody(input.cartId, input),
			signal: options.signal,
			errorMessage: "shopkit: could not create checkout session",
		});
		await this.store.setCheckoutSessionId(
			session.sessionId,
			options.cart?.storeId,
		);
		return this.syncSessionCart(session, options);
	}

	/**
	 * The body `/checkout/sessions` and `/checkout/handoff` share.
	 *
	 * `successMode`, the `storefrontId` + `surface` pair and `currency` are
	 * omitted unless they resolve to something (the call's own value, else the
	 * client's). `successUrl` is trimmed and omitted when blank (inline mode).
	 */
	private async sessionBody(
		cartId: string,
		input: Omit<CreateSessionInput, "cartId">,
	): Promise<Record<string, unknown>> {
		const successUrl = input.successUrl?.trim();
		const currency =
			input.currency !== undefined
				? normalizeCurrency(input.currency)
				: ((await this.currency?.resolve()) ?? null);
		return {
			cartId,
			successUrl: successUrl || undefined,
			cancelUrl: input.cancelUrl,
			backUrl: input.backUrl,
			language: input.language,
			prefill: input.prefill,
			embed: input.embed,
			theme: input.theme,
			...(input.successMode !== undefined && {
				successMode: input.successMode,
			}),
			...(resolveStorefrontAttribution(input, this.config.storefront) ?? {}),
			...(currency !== null && { currency }),
		};
	}

	/**
	 * Re-read the cart into a session whose snapshot has gone stale.
	 *
	 * Session creation is **idempotent on `cartId`**: a second create for the
	 * same cart returns the first session, with the cart as it looked then. A
	 * shopper who went to checkout, came back and added something would
	 * otherwise reach a checkout missing the new lines, with no error.
	 *
	 * Patches only when the snapshot differs from the live cart. Pass `cart`
	 * when you already have it to skip the cart read.
	 */
	async syncCart(
		sessionId: string,
		options: RequestOptions & { cart?: Cart } = {},
	): Promise<CheckoutSessionSnapshot | null> {
		const session = await this.getSession(sessionId, options);
		if (!session) return null;
		const patched = await this.rehydrateIfStale(
			sessionId,
			session.cartId,
			session.fields,
			options,
		);
		return patched ? { ...session, ...patched } : session;
	}

	/**
	 * Compare the session's cart snapshot with the live cart and patch when they
	 * disagree. Returns the patch result, or null when nothing was needed.
	 */
	private async rehydrateIfStale(
		sessionId: string,
		cartId: string | null,
		fields: SessionFieldMap,
		options: RequestOptions & { cart?: Cart } = {},
	): Promise<PatchResult | null> {
		if (!cartId) return null;

		const live =
			options.cart ?? (await this.cart.get(cartId, { signal: options.signal }));
		// A cart the server no longer has is not something a patch can fix; leave
		// the session as-is so the caller sees the real error at checkout.
		if (!live) return null;

		const snapshot = (fields.cart?.value as CartFieldValue | null) ?? null;
		if (cartFingerprint(snapshot?.items) === liveCartFingerprint(live.items)) {
			return null;
		}

		return this.transport.request<PatchResult>({
			method: "PATCH",
			path: `/checkout/sessions/${encodeURIComponent(sessionId)}`,
			// `{}` makes the server re-read the cart itself, keeping prices server-side.
			body: { cart: {} },
			signal: options.signal,
			errorMessage: "shopkit: could not refresh the checkout session cart",
		});
	}

	/** Fold a rehydration (if any) back into a freshly created session. */
	private async syncSessionCart(
		session: CheckoutSession,
		options: RequestOptions & { cart?: Cart },
	): Promise<CheckoutSession> {
		const patched = await this.rehydrateIfStale(
			session.sessionId,
			session.cartId,
			session.fields,
			options,
		);
		if (!patched) return session;
		return { ...session, fields: patched.fields, data: patched.data };
	}

	/**
	 * Read a session. Useful on the thank-you page to show what was bought
	 * (`data.cart_products`, `data.order_total`) without a second cart lookup.
	 * Null when the session is unknown or has been cleaned up.
	 */
	async getSession(
		sessionId: string,
		options: RequestOptions = {},
	): Promise<CheckoutSessionSnapshot | null> {
		this.scopes.assert("checkout:read", "checkout.getSession()");
		return this.transport.requestOrNull<CheckoutSessionSnapshot>({
			method: "GET",
			path: `/checkout/sessions/${encodeURIComponent(sessionId)}`,
			signal: options.signal,
			errorMessage: "shopkit: could not load checkout session",
		});
	}

	/** The remembered checkout session id, or null. */
	async currentSessionId(): Promise<string | null> {
		return this.store.getCheckoutSessionId();
	}

	/**
	 * The shop's numeric store id as remembered from the last checkout session
	 * or cart, or null when nothing is known yet. Synchronous and request-free;
	 * useful on the return leg after the cart is gone (for example as a
	 * purchase event's dedup key).
	 */
	rememberedStoreId(): string | null {
		for (const remembered of [
			this.store.peekCheckoutStoreId(),
			this.store.peekStoreId(),
		]) {
			if (remembered !== null && isNumericStoreId(remembered))
				return remembered;
		}
		return null;
	}

	// Handoff

	/**
	 * The URL of the checkout-v2 hosted checkout for a session:
	 * `/checkout/{storeId}/{sessionId}`, a shareable, resumable link.
	 *
	 * **checkout-v2 only, and it makes no request.** A legacy-checkout shop
	 * needs a URL for an order the platform creates first, so for such a shop
	 * this returns a link that cannot be opened. Prefer {@link start}, which
	 * returns the right URL either way.
	 *
	 * `storeId` is the shop's numeric id (`Cart.storeId`), not the prefix in the
	 * publishable key (`shopkit.shopPrefix`). It defaults to the id remembered
	 * from the last cart; when none is known this throws.
	 */
	hostedUrl(input: HostedCheckoutUrlInput | string): string {
		const params = typeof input === "string" ? { sessionId: input } : input;
		if (!params.sessionId) {
			throw new ShopkitConfigError("shopkit: hostedUrl() needs a sessionId.");
		}
		const storeId = this.resolveStoreId(params);
		const path = `/checkout/${encodeURIComponent(storeId)}/${encodeURIComponent(params.sessionId)}`;
		const query = params.language
			? `?lang=${encodeURIComponent(params.language)}`
			: "";
		return `${this.config.checkoutUrl}${path}${query}`;
	}

	/**
	 * The URL of the checkout document to frame for a session:
	 * `/embed/{storeId}/{sessionId}`. `storeId` is as for {@link hostedUrl}.
	 *
	 * The embed document is served with a `frame-ancestors` header naming the
	 * session's recorded embed origin, so a session created without an `embed`
	 * block renders a refusal here. {@link mount} is the supported way to use
	 * this; build it by hand only when framing the checkout yourself.
	 */
	embedUrl(input: HostedCheckoutUrlInput | string): string {
		const params = typeof input === "string" ? { sessionId: input } : input;
		if (!params.sessionId) {
			throw new ShopkitConfigError("shopkit: embedUrl() needs a sessionId.");
		}
		const storeId = this.resolveStoreId(params);
		const path = `/embed/${encodeURIComponent(storeId)}/${encodeURIComponent(params.sessionId)}`;
		const query = params.language
			? `?lang=${encodeURIComponent(params.language)}`
			: "";
		return `${this.config.checkoutUrl}${path}${query}`;
	}

	/**
	 * Explicit `storeId` (or deprecated `shopId`), else the id remembered from
	 * the last cart, else the one remembered with the checkout session (which
	 * outlives the cart). An explicit value must be numeric.
	 */
	private resolveStoreId(params: HostedCheckoutUrlInput): string {
		const explicit =
			normalizeStoreId(params.storeId) ?? normalizeStoreId(params.shopId);
		if (explicit !== null) return this.assertNumericStoreId(explicit);

		// The remembered values only ever come from `Cart.storeId`, but a cookie
		// is writable by anyone; a non-numeric one is treated as not remembered.
		for (const remembered of [
			this.store.peekStoreId(),
			this.store.peekCheckoutStoreId(),
		]) {
			if (remembered !== null && isNumericStoreId(remembered))
				return remembered;
		}

		throw new ShopkitConfigError(
			"shopkit: the hosted checkout URL needs the shop's numeric store id " +
				"and none is known yet. " +
				"It is `cart.storeId` — not the prefix in the publishable " +
				"key, which the hosted checkout does not recognise. Pass " +
				"`storeId: cart.storeId`, or use `checkout.start()`, which reads it " +
				"from the cart it checks out.",
		);
	}

	private assertNumericStoreId(value: string): string {
		if (value === this.config.shopPrefix) {
			throw new ShopkitConfigError(
				`shopkit: hostedUrl() was given "${value}", which is the key's shop ` +
					"prefix (`shopkit.shopPrefix`), not a store id. The hosted checkout " +
					`does not recognise it ("We couldn't find ${value}"); it needs the ` +
					"shop's NUMERIC id — pass `storeId: cart.storeId`, or use " +
					"`checkout.start()`.",
			);
		}
		if (!isNumericStoreId(value)) {
			throw new ShopkitConfigError(
				`shopkit: hostedUrl() needs a numeric store id (\`Cart.storeId\`), got "${value}". ` +
					"Pass `storeId: cart.storeId`, or use `checkout.start()`.",
			);
		}
		return value;
	}

	/**
	 * Cart → session → handoff URL, in one call. The usual entry point for a
	 * "Checkout" button.
	 *
	 * Returns the URL rather than navigating, so it works unchanged in a server
	 * action (`redirect(url)`), a route handler (302) and the browser
	 * (`location.assign`).
	 *
	 * On a server client (one built with a `cookies` accessor) the shopper's
	 * consent is forwarded on the URL so the hosted checkout can set Consent
	 * Mode before its own tags load; see `ConsentResource.decorateHandoff`.
	 * `consent: false` in the config turns it off.
	 */
	async start(
		input: StartCheckoutInput,
		options: RequestOptions = {},
	): Promise<StartCheckoutResult> {
		// Checked before the cart is touched, so a config error leaves no cart
		// behind.
		assertSuccessTarget(input, "checkout.start()");
		// Without a cartId this reuses the remembered cart, so a per-call
		// campaign may only restate the client's own.
		if (!input.cartId) {
			assertRememberingCallBinding(
				input,
				this.config.storefront,
				"checkout.start()",
			);
		}
		// The cart object is needed for the stale-snapshot check and its `storeId`.
		const cart = input.cartId
			? await this.cart.get(input.cartId, options)
			: await this.cart.ensure({ ...options, surface: input.surface });
		if (!cart) {
			throw new ShopkitConfigError(
				`shopkit: cart ${input.cartId} does not exist, so there is nothing to check out.`,
			);
		}

		this.scopes.assert("checkout:write", "checkout.start()");
		const handoff = await this.transport.request<CheckoutHandoff>({
			method: "POST",
			path: "/checkout/handoff",
			body: await this.sessionBody(cart.id, input),
			signal: options.signal,
			errorMessage: "shopkit: could not start checkout",
		});

		if (handoff.checkout === "legacy") {
			// No local fallback: the URL names an order only the platform knows.
			// Without a uuid there is no handle to confirm the order by.
			if (!handoff.legacyOrderUuid) {
				throw new ShopkitConfigError(
					"shopkit: this shop is on the legacy Quickbutik checkout and the " +
						"order it created carries no id, so there is nothing to send the " +
						"shopper to and nothing to confirm the order by. This is a " +
						"platform-side problem, not something the storefront can retry " +
						"— contact Quickbutik support.",
				);
			}
			if (!handoff.hostedUrl) {
				throw new ShopkitConfigError(
					"shopkit: this shop is on the legacy Quickbutik checkout and the " +
						"platform could not prepare a checkout link for it. This is a " +
						"shop/platform configuration problem, not something the " +
						"storefront can retry — contact Quickbutik support.",
				);
			}
			await this.store.setCheckoutSessionId(handoff.legacyOrderUuid);
			return {
				checkout: "legacy",
				url: await this.withConsent(handoff.hostedUrl),
				handoffId: handoff.legacyOrderUuid,
				legacyOrderUuid: handoff.legacyOrderUuid,
				cartId: handoff.cartId,
				// The legacy checkout is not embeddable.
				embedUrl: null,
			};
		}

		const { checkout: _flavour, hostedUrl, embedUrl, ...session } = handoff;
		// Stored with the session: the cart's copy dies with the cart, usually
		// before an embedded checkout's return leg arrives.
		await this.store.setCheckoutSessionId(session.sessionId, cart.storeId);
		const synced = await this.syncSessionCart(session, { ...options, cart });
		return {
			checkout: "v2",
			url: await this.withConsent(
				this.resolveV2Url(hostedUrl, synced.sessionId, cart.storeId, input),
			),
			handoffId: synced.sessionId,
			cartId: synced.cartId,
			session: synced,
			embedUrl: input.embed
				? this.resolveEmbedUrl(
						embedUrl,
						synced.sessionId,
						cart.storeId,
						input.language,
					)
				: null,
		};
	}

	/** The handoff URL with a server client's consent on it; see {@link start}. */
	private withConsent(url: string): Promise<string> {
		return this.consent?.decorateHandoff(url) ?? Promise.resolve(url);
	}

	/**
	 * Which checkout-v2 URL wins:
	 *
	 * 1. An explicitly configured `checkoutUrl` (a local or preview environment,
	 *    or a checkout proxied onto the merchant's own domain).
	 * 2. The platform's own URL, which stays right if the hosted checkout moves.
	 * 3. The local builder, only when the platform sent no `hostedUrl` at all.
	 *
	 * An explicit `null` means no host is configured for this shop; the default
	 * host would send the shopper to the production checkout with a session it
	 * does not know, so this throws instead.
	 */
	private resolveV2Url(
		hostedUrl: string | null | undefined,
		sessionId: string,
		storeId: number,
		input: StartCheckoutInput,
	): string {
		if (this.config.checkoutUrlConfigured || hostedUrl === undefined) {
			return this.hostedUrl({
				sessionId,
				storeId,
				language: input.language ?? undefined,
			});
		}
		if (!hostedUrl) {
			throw new ShopkitConfigError(
				"shopkit: the platform has no checkout host configured for this " +
					"shop, so it could not prepare a checkout link. Guessing the " +
					"default host would send the shopper to the production checkout " +
					"with a session it does not know. Set `checkoutUrl` if you know " +
					"where this environment's checkout lives, or contact Quickbutik " +
					"support.",
			);
		}
		return hostedUrl;
	}

	/**
	 * Which embed URL wins: an explicitly configured `checkoutUrl`, else the
	 * platform's. Unlike {@link resolveV2Url}, null or absent is not fatal (the
	 * caller falls back to the redirect checkout) and is never built locally.
	 */
	private resolveEmbedUrl(
		embedUrl: string | null | undefined,
		sessionId: string,
		storeId: number,
		language: string | null | undefined,
	): string | null {
		if (this.config.checkoutUrlConfigured) {
			return this.embedUrl({
				sessionId,
				storeId,
				language: language ?? undefined,
			});
		}
		return embedUrl ?? null;
	}

	/**
	 * Add a product and hand off immediately — the "Buy now" button. Uses the
	 * remembered cart, so an existing basket is carried along rather than
	 * replaced.
	 *
	 * Returns the URL rather than navigating, as {@link start} does;
	 * `useCheckout().buyNow` and `<qb-buy-now>` are the navigating wrappers.
	 * The result also carries `cart` as the add left it, so a caller keeping
	 * its own cart state can update it without a second read.
	 */
	async buyNow(
		item: AddCartItemInput,
		input: StartCheckoutInput,
		options: RequestOptions = {},
	): Promise<BuyNowResult> {
		// Checked before the add, so a config error leaves nothing in the basket.
		assertSuccessTarget(input, "checkout.buyNow()");
		// Adds to the remembered cart, so a per-call campaign may only restate
		// the client's own.
		assertRememberingCallBinding(
			input,
			this.config.storefront,
			"checkout.buyNow()",
		);
		const cart = await this.cart.add(item, {
			...options,
			surface: input.surface,
		});
		const result = await this.start({ ...input, cartId: cart.id }, options);
		return { ...result, cart };
	}

	// Embedded checkout

	/**
	 * Render the checkout inside this page, in an iframe served from the
	 * checkout's own origin.
	 *
	 * ```ts
	 * const checkout = await shopkit.checkout.mount("#checkout", {
	 *   successUrl: "/thanks",
	 *   backUrl: "/cart",
	 * })
	 * checkout.on("complete", ({ orderNumber }) => track(orderNumber))
	 * ```
	 *
	 * Makes the same single `/checkout/handoff` request as {@link start}, with
	 * an `embed` block added.
	 *
	 * **It always resolves.** When there is nothing to frame — the shop runs the
	 * legacy checkout, the platform returned no embed URL, or this page cannot
	 * navigate its own top window — the handle comes back in its `fallback`
	 * state, emits `fallback`, and (unless `fallbackRedirect: false`) sends the
	 * shopper to the hosted checkout instead. A genuine failure (no cart, a
	 * rejected key, a 500) still rejects, as `start()` would.
	 *
	 * A frame that never answers (typically because this page is not the
	 * session's `embedOrigin`) is taken down after `handshakeTimeoutMs` (15 s by
	 * default) and falls back the same way, with reason `handshake-timeout`.
	 *
	 * **One checkout per container.** Mounting into an element that already
	 * shows one destroys the earlier handle first, so a re-render or a "try
	 * again" button ends up with one checkout. The platform returns the same
	 * session for the same cart, so nothing is charged twice.
	 *
	 * Browser only: it builds a DOM node and listens for `message`.
	 */
	async mount(
		container: Element | string,
		input: MountCheckoutInput,
		options: RequestOptions = {},
	): Promise<EmbeddedCheckout> {
		const target = resolveContainer(container);
		const embed: SessionEmbed = input.embed ?? {
			origin: input.embedOrigin ?? window.location.origin,
			returnUrl: input.returnUrl ?? currentPageUrl(),
		};

		const result = await this.start({ ...input, embed }, options);

		if (result.checkout === "legacy") {
			return this.fallbackHandle(input, "legacy", result.url, result.handoffId);
		}
		if (!canNavigateTopWindow()) {
			console.warn(
				"shopkit: this page cannot be the top window for a payment, because " +
					"it is itself inside a frame it may not navigate — a preview pane " +
					"in an AI site builder, typically. A redirect payment method " +
					"(Klarna, Swish, iDEAL, a full-page 3-D Secure) could not return " +
					"the shopper from there, so the checkout opens as a full-page " +
					"redirect instead. The published site embeds normally; nothing " +
					"needs changing here.",
			);
			return this.fallbackHandle(
				input,
				"no-top-navigation",
				result.url,
				result.handoffId,
			);
		}
		// Not just a null check: the URL becomes an iframe `src` and a
		// `postMessage` target, and an unparseable one would throw after
		// `start()` has already created the session.
		if (!isSafeNavigationUrl(result.embedUrl)) {
			console.warn(
				"shopkit: this shop's checkout cannot be embedded, so the shopper " +
					"will be sent to the hosted checkout instead. The platform " +
					"returned no usable embed URL for the session it just created — " +
					"normally because this shop is not enabled for the embedded " +
					"checkout, or because the platform predates it. Nothing in this " +
					"page can fix that: keep `mount()` (it degrades on its own) and " +
					"contact Quickbutik support, or set `checkoutUrl` if you know " +
					"where this environment's checkout lives.",
			);
			return this.fallbackHandle(
				input,
				"no-embed-url",
				result.url,
				result.handoffId,
			);
		}

		return new EmbeddedCheckout({
			mode: "embed",
			container: target,
			url: result.embedUrl,
			checkoutOrigin: originOf(result.embedUrl),
			sessionId: result.handoffId,
			successUrl: input.successUrl,
			fallbackUrl: result.url,
			...renderOptions(input),
		});
	}

	/**
	 * Frame an existing session, after a redirect payment method returns.
	 *
	 * A redirect payment method (Klarna, Swish, iDEAL, a full-page 3-D Secure)
	 * returns the shopper to the page that created the session with
	 * `?qb_checkout_session=<id>&qb_checkout_shop=<storeId>`; call this with
	 * that id to resume in the frame. `<qb-checkout>` and `<Checkout>` do this
	 * for you.
	 *
	 * Pass `storeId` (`readReturnedCheckout().storeId`) and no storage is
	 * needed; without it the remembered id is used, and this rejects if none
	 * exists. Falls back like {@link mount} when the frame never answers.
	 */
	async resume(
		container: Element | string,
		sessionId: string,
		input: ResumeCheckoutInput = {},
	): Promise<EmbeddedCheckout> {
		const target = resolveContainer(container);
		const { url, hostedUrl, storeId } = this.resumeUrls(sessionId, input);
		// Remembered again for the thank-you page's `<qb-order-confirmation>`;
		// the shopper may have left this tab on the way to the PSP.
		await this.store.setCheckoutSessionId(sessionId, storeId);

		return new EmbeddedCheckout({
			mode: "embed",
			container: target,
			url,
			checkoutOrigin: originOf(url),
			sessionId,
			successUrl: input.successUrl,
			fallbackUrl: hostedUrl,
			...renderOptions(input),
		});
	}

	/**
	 * The embed URL to resume at, the hosted fallback URL, and the store id
	 * both use. With no store id known, throws a message aimed at a returning
	 * shopper rather than the generic one.
	 */
	private resumeUrls(
		sessionId: string,
		input: ResumeCheckoutInput,
	): { url: string; hostedUrl: string; storeId: string } {
		let storeId: string;
		try {
			storeId = this.resolveStoreId({
				sessionId,
				storeId: input.storeId ?? undefined,
			});
		} catch (error) {
			if (input.storeId != null) throw error;
			throw new ShopkitConfigError(
				"shopkit: checkout.resume() cannot build the URL of the checkout to " +
					"resume, because this shop's numeric store id is not known here. " +
					"This is what a shopper hits when they come back from a payment " +
					"redirect (Klarna, Swish, iDEAL, a full-page 3-D Secure) on a " +
					"return URL without `qb_checkout_shop` on it, in a browser that " +
					"cleared this site's data in the meantime: neither the URL nor " +
					"storage carries the id. They have most likely PAID — do not " +
					"send them back to a new checkout. Pass `storeId` explicitly (it " +
					"is `readReturnedCheckout().storeId`, the same numeric " +
					"`cart.storeId` the checkout URL carries) and resume works with " +
					"no storage at all.",
			);
		}
		const params = { sessionId, storeId, language: input.language };
		return {
			url: this.embedUrl(params),
			hostedUrl: this.hostedUrl(params),
			storeId,
		};
	}

	/** A handle for "there is nothing to frame here", never an exception. */
	private fallbackHandle(
		input: MountCheckoutInput,
		reason: EmbeddedCheckoutFallbackReason,
		url: string | null,
		sessionId: string | null,
	): EmbeddedCheckout {
		return new EmbeddedCheckout({
			mode: "fallback",
			reason,
			url,
			sessionId,
			redirect: input.fallbackRedirect !== false,
		});
	}

	// The return leg

	/**
	 * One snapshot of the order-creation status for a handoff.
	 *
	 * Order creation is asynchronous: the PSP authorizes, then the platform
	 * builds the order. In between the status is `processing_payment` and there
	 * is no order number yet.
	 *
	 * Takes either handle from `StartCheckoutResult.handoffId` (a checkout-v2
	 * session id or a legacy order uuid). On a legacy handoff a failed payment
	 * looks untouched, so `no_attempt` means "not paid yet", not "the shopper
	 * never tried".
	 */
	async confirmation(
		sessionId: string,
		options: RequestOptions = {},
	): Promise<SessionConfirmation> {
		this.scopes.assert("checkout:read", "checkout.confirmation()");
		return this.transport.request<SessionConfirmation>({
			method: "GET",
			path: `/checkout/sessions/${encodeURIComponent(sessionId)}/confirmation`,
			signal: options.signal,
			errorMessage: "shopkit: could not load checkout confirmation",
		});
	}

	/**
	 * Poll until the order exists, the payment terminally fails, or the caps are
	 * reached. This is what a thank-you page should call.
	 *
	 * A `timeout` outcome is NOT a failure — the order may still land. Show "we
	 * are still processing your order" and let the customer refresh. On a legacy
	 * handoff `timeout` is the normal outcome for a shopper who has not paid,
	 * because that checkout never reports `failed`.
	 */
	async pollConfirmation(
		sessionId: string,
		options: PollConfirmationOptions = {},
	): Promise<ConfirmationOutcome> {
		const maxPolls = options.maxPolls ?? DEFAULT_MAX_POLLS;
		const maxTotalMs = options.maxTotalMs ?? DEFAULT_MAX_TOTAL_MS;
		const startedAt = Date.now();
		let lastStatus: ConfirmationStatus | null = null;

		for (let attempt = 0; attempt < maxPolls; attempt++) {
			if (options.signal?.aborted) return { kind: "aborted" };

			let confirmation: SessionConfirmation;
			try {
				confirmation = await this.confirmation(sessionId, {
					signal: options.signal,
				});
			} catch {
				if (options.signal?.aborted) return { kind: "aborted" };
				// A single failed poll is not terminal; keep going until the caps bite.
				if (attempt === maxPolls - 1) return { kind: "timeout", lastStatus };
				await delay(pollDelay(attempt));
				continue;
			}

			lastStatus = confirmation.status;
			options.onUpdate?.(confirmation);

			if (confirmation.status === "completed") {
				await this.finalize();
				return {
					kind: "completed",
					orderNumber: confirmation.orderNumber ?? null,
					confirmation,
				};
			}
			if (confirmation.status === "failed") {
				return { kind: "failed", confirmation };
			}

			const wait = pollDelay(attempt, confirmation.retryAfterMs);
			if (Date.now() - startedAt + wait > maxTotalMs) {
				return { kind: "timeout", lastStatus };
			}
			await delay(wait);
		}

		return { kind: "timeout", lastStatus };
	}

	/**
	 * Forget the cart and session ids. Called automatically once a confirmation
	 * comes back `completed`, so the next visit starts a clean basket instead of
	 * resurrecting a cart that has already been bought.
	 *
	 * The remembered store id is kept, so a reload of the thank-you page builds
	 * the same `purchase` event key ({@link rememberedStoreId}) and the order
	 * is not counted twice.
	 */
	async finalize(): Promise<void> {
		await this.store.clearCartId();
		await this.store.clearCheckoutSessionId();
	}

	/**
	 * Parse the hosted checkout's post-payment redirect.
	 *
	 * The shopper is sent to `<successUrl origin>/success/<orderNumber>?hash=…&t=…`
	 * — only the ORIGIN of `successUrl` is used, so this path is where a
	 * headless storefront must mount its thank-you route. Both checkout
	 * generations return this way.
	 *
	 * `hash` is a legacy integrity token and is returned for completeness only;
	 * treat the order as real once {@link confirmation} says `completed`.
	 */
	parseReturnUrl(url: string | URL): HostedCheckoutReturn | null {
		let parsed: URL;
		try {
			parsed = typeof url === "string" ? new URL(url, "http://localhost") : url;
		} catch {
			return null;
		}
		const match = /\/success\/(\d+)\/?$/.exec(parsed.pathname);
		if (!match?.[1]) return null;
		const orderNumber = Number.parseInt(match[1], 10);
		if (!Number.isFinite(orderNumber)) return null;
		const timestamp = Number.parseInt(parsed.searchParams.get("t") ?? "", 10);
		return {
			orderNumber,
			hash: parsed.searchParams.get("hash"),
			timestamp: Number.isFinite(timestamp) ? timestamp : null,
		};
	}
}

/**
 * The `successUrl` rule: redirect mode (the default) needs one, inline mode
 * does not, and `successMode` must be a mode the platform knows. Thrown before
 * any request, by name.
 */
function assertSuccessTarget(
	input: Pick<CreateSessionInput, "successUrl" | "successMode">,
	operation: string,
): void {
	const mode: unknown = input.successMode;
	if (
		mode !== undefined &&
		!(SUCCESS_MODES as readonly unknown[]).includes(mode)
	) {
		throw new ShopkitConfigError(
			`shopkit: ${operation} got successMode ${JSON.stringify(mode)}; it must be ` +
				`${SUCCESS_MODES.map((m) => `"${m}"`).join(" or ")} (or omitted, which means "redirect").`,
		);
	}
	if (mode === "inline") return;
	const url = input.successUrl;
	if (typeof url === "string" && url.trim().length > 0) return;
	throw new ShopkitConfigError(
		`shopkit: ${operation} needs a successUrl — the hosted checkout sends the ` +
			"shopper to `<its origin>/success/<orderNumber>` after payment. Pass one, " +
			'or set successMode: "inline" to have the checkout show the confirmation ' +
			"itself and never redirect (then set backUrl so the shopper can get home).",
	);
}

/** The shape of the session's `cart` field, as far as staleness detection cares. */
interface CartFieldValue {
	items?: Array<{
		productId?: string;
		variantId?: string;
		quantity?: number;
		properties?: Array<{ propertyId: number; value: string }>;
	}>;
}

/**
 * A stable, order-independent signature of a cart's lines.
 *
 * Compares product, variant, product-field input and quantity only; prices
 * are recomputed server-side on every read. Ids are normalized to bare strings
 * because the session snapshot stores strings (`"27"`) while the Cart API
 * returns numbers (`27`).
 */
function cartFingerprint(items: CartFieldValue["items"] | undefined): string {
	return (items ?? [])
		.map(
			(item) =>
				`${normalizeId(item.productId)}:${normalizeId(item.variantId)}:${linePropertiesKey(item.properties)}:${item.quantity ?? 0}`,
		)
		.sort()
		.join("|");
}

function liveCartFingerprint(items: CartItem[]): string {
	return items
		.map(
			(item) =>
				`${normalizeId(item.productId)}:${normalizeId(item.variantId)}:${linePropertiesKey(item.properties)}:${item.quantity}`,
		)
		.sort()
		.join("|");
}

function normalizeId(id: string | number | undefined | null): string {
	if (id === undefined || id === null) return "";
	return String(id).replace(/^prod_/, "");
}

/** A caller-supplied store id, trimmed to a path segment, or null when unusable. */
function normalizeStoreId(
	value: string | number | undefined | null,
): string | null {
	if (value === undefined || value === null) return null;
	const text = String(value).trim();
	return text.length > 0 ? text : null;
}

/** Store ids are integers (`Cart.storeId: number`); the key's prefix never is. */
function isNumericStoreId(value: string): boolean {
	return /^\d+$/.test(value);
}

/** Backoff for poll `attempt`, raised (never lowered) by the server's hint. */
function pollDelay(attempt: number, retryAfterMs?: number): number {
	const index = Math.min(
		Math.max(attempt, 0),
		CONFIRMATION_BACKOFF_MS.length - 1,
	);
	const base = CONFIRMATION_BACKOFF_MS[index] ?? 5000;
	if (typeof retryAfterMs !== "number" || !Number.isFinite(retryAfterMs))
		return base;
	return Math.max(base, Math.min(retryAfterMs, RETRY_AFTER_CAP_MS));
}

/**
 * The element to render into, from a node or a selector. A selector that
 * matches nothing throws a named error rather than an opaque one later.
 */
function resolveContainer(container: Element | string): Element {
	if (typeof container !== "string") return container;
	if (typeof document === "undefined") {
		throw new ShopkitConfigError(
			"shopkit: checkout.mount() needs a browser — it builds an iframe and " +
				"listens for messages. Call it from a client component / an effect, " +
				"not during a server render.",
		);
	}
	const found = document.querySelector(container);
	if (!found) {
		throw new ShopkitConfigError(
			`shopkit: checkout.mount("${container}") found no such element. Pass ` +
				"the element itself, or make sure the container is in the DOM before " +
				"mounting.",
		);
	}
	return found;
}

/**
 * This page's URL, minus the parameters the kit itself puts there.
 *
 * Otherwise a second redirect payment attempt would carry the first
 * attempt's `qb_checkout_session`/`qb_checkout_shop` into its return URL.
 */
function currentPageUrl(): string {
	const url = new URL(window.location.href);
	url.searchParams.delete(CHECKOUT_SESSION_PARAM);
	url.searchParams.delete(CHECKOUT_SHOP_PARAM);
	return url.toString();
}

/** The origin of a URL we built or the platform gave us; both are absolute. */
function originOf(url: string): string {
	return new URL(url).origin;
}

/** The presentation half of a mount/resume input, without the session half. */
function renderOptions(input: EmbedRenderOptions): EmbedRenderOptions {
	return {
		minHeight: input.minHeight,
		title: input.title,
		confirmation: input.confirmation,
		handleNavigation: input.handleNavigation,
		fallbackRedirect: input.fallbackRedirect,
		handshakeTimeoutMs: input.handshakeTimeoutMs,
	};
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
