import { ShopkitApiError, ShopkitConfigError } from "./errors.js";

/**
 * Campaign storefronts (Säljplatser in the Quickbutik admin): campaigns a
 * merchant runs beside the shop, with their own prices, quantity limits and
 * time window. A storefront selling into one names it on the cart and the
 * checkout; the platform applies the campaign's prices and limits and
 * attributes the order.
 *
 * `storefrontId` (`sf_` + a 26-character Crockford ULID) and `surface` (where
 * the campaign was presented; attribution only) are sent both or neither.
 */

/**
 * Where a campaign storefront was presented to the shopper. Attribution, not
 * behaviour.
 *
 * - `hosted`  — the campaign's own page on the shop's domain.
 * - `link`    — a short or shared link that lands on the campaign.
 * - `embed`   — rendered inside a third-party page (iframe / script embed).
 * - `shopkit` — inside a storefront built on this SDK. The default here.
 * - `agentic` — reached by an AI agent acting for the shopper.
 */
export const STOREFRONT_SURFACES = [
	"hosted",
	"link",
	"embed",
	"shopkit",
	"agentic",
] as const;

export type StorefrontSurface = (typeof STOREFRONT_SURFACES)[number];

/** The surface sent when a storefront is bound and none was named. */
export const DEFAULT_STOREFRONT_SURFACE: StorefrontSurface = "shopkit";

/**
 * `sf_` + 26 characters of Crockford base32 (no I, L, O, U). Case-insensitive:
 * the platform accepts either case and stores one canonical spelling.
 */
export const STOREFRONT_ID_PATTERN = /^sf_[0-9a-hjkmnp-tv-z]{26}$/i;

/** True for a well-formed campaign storefront id. Says nothing about whether it exists. */
export function isStorefrontId(value: unknown): value is string {
	return typeof value === "string" && STOREFRONT_ID_PATTERN.test(value);
}

export function isStorefrontSurface(
	value: unknown,
): value is StorefrontSurface {
	return (
		typeof value === "string" &&
		(STOREFRONT_SURFACES as readonly string[]).includes(value)
	);
}

/** `ShopkitConfig.storefront` — bind a whole client to one campaign. */
export interface ShopkitStorefrontConfig {
	/** The campaign storefront id, `sf_…`. */
	id: string;
	/** Defaults to `"shopkit"`. */
	surface?: StorefrontSurface;
}

/** The binding with the default applied — what `ShopkitClient.storefront` is. */
export interface StorefrontBinding {
	id: string;
	surface: StorefrontSurface;
}

/**
 * Per-call attribution.
 *
 * Stateless calls (`cart.create()`, and `checkout.createSession()` /
 * `checkout.start()` given an explicit `cartId`) accept any campaign. Calls
 * that reuse the remembered cart (`cart.ensure()`, `cart.add()`, `start()` /
 * `buyNow()` without a `cartId`) accept only the client's own binding, since
 * that cart was created for one campaign.
 */
export interface StorefrontAttribution {
	/** The campaign storefront to sell into. */
	storefrontId?: string;
	/**
	 * Where the campaign was presented. Ignored unless a `storefrontId` resolves
	 * from this call or the client.
	 */
	surface?: StorefrontSurface;
}

/** The pair as it goes on the wire — both present, or the object is not sent. */
export interface StorefrontWireAttribution {
	storefrontId: string;
	surface: StorefrontSurface;
}

/**
 * Turn `ShopkitConfig.storefront` / `storefrontId` into a binding, or throw a
 * `ShopkitConfigError` that names the problem. `null`, `undefined` and an
 * empty `storefrontId` mean "no binding"; two different ids throw rather than
 * silently pricing the cart with the wrong campaign.
 */
export function resolveStorefrontBinding(
	config: ShopkitStorefrontConfig | null | undefined,
	storefrontId?: string | null,
): StorefrontBinding | null {
	const shorthand =
		typeof storefrontId === "string" ? storefrontId.trim() : storefrontId;
	const hasShorthand =
		shorthand !== undefined && shorthand !== null && shorthand !== "";
	if (hasShorthand) assertStorefrontId(shorthand, "`storefrontId`");

	if (config === undefined || config === null) {
		return hasShorthand
			? { id: shorthand, surface: DEFAULT_STOREFRONT_SURFACE }
			: null;
	}
	const id = typeof config.id === "string" ? config.id.trim() : config.id;
	assertStorefrontId(id, "`storefront.id`");
	const surface = config.surface ?? DEFAULT_STOREFRONT_SURFACE;
	assertStorefrontSurface(surface, "`storefront.surface`");
	if (hasShorthand && !sameStorefrontId(shorthand, id)) {
		throw new ShopkitConfigError(
			`shopkit: the config names two different campaign storefronts — ` +
				`storefront.id ${JSON.stringify(id)} and storefrontId ` +
				`${JSON.stringify(shorthand)}. A client sells into exactly one. ` +
				"`storefrontId` is shorthand for `storefront: { id }`; give one of " +
				"them, or make them agree.",
		);
	}
	return { id, surface };
}

/**
 * The campaign a product READ is priced for: the call's own `storefrontId`,
 * else the client's binding, else none.
 *
 * Reads are stateless, so any campaign may be named per call, and `null` opts
 * a bound client out for one call. An empty string falls back to the binding.
 * A malformed id throws a `ShopkitConfigError`.
 */
export function resolveStorefrontReadId(
	perCall: string | null | undefined,
	binding: StorefrontBinding | null,
): string | null {
	if (perCall === null) return null;
	const given = typeof perCall === "string" ? perCall.trim() : perCall;
	if (given === undefined || given === "") return binding?.id ?? null;
	assertStorefrontId(given, "`storefrontId`");
	return given;
}

/**
 * Resolve what a call sends: the call's own `storefrontId` else the client's,
 * and the call's own `surface` else the client's else `"shopkit"`. `null` when
 * no storefront resolves; the caller then sends neither field. A malformed
 * per-call value throws a `ShopkitConfigError`.
 */
export function resolveStorefrontAttribution(
	perCall: StorefrontAttribution | undefined,
	binding: StorefrontBinding | null,
): StorefrontWireAttribution | null {
	const given = perCallStorefrontId(perCall);
	const storefrontId = given ?? binding?.id ?? null;
	if (storefrontId === null) return null;
	assertStorefrontId(storefrontId, "`storefrontId`");
	const surface =
		perCall?.surface ?? binding?.surface ?? DEFAULT_STOREFRONT_SURFACE;
	assertStorefrontSurface(surface, "`surface`");
	return { storefrontId, surface };
}

/**
 * Calls that reuse the remembered cart accept a per-call `storefrontId` only
 * when it names the campaign the client is bound to; anything else throws
 * before any request.
 *
 * The remembered cart belongs to one campaign (or none). The platform refuses
 * a checkout naming another (`storefront_mismatch`), and on an unbound client
 * `ensure()` would otherwise remember a campaign-priced cart under the shop's
 * plain `qb_cart_id`. `surface` is not checked: it is attribution for this
 * checkout only.
 */
export function assertRememberingCallBinding(
	perCall: StorefrontAttribution | undefined,
	binding: StorefrontBinding | null,
	operation: string,
): void {
	const given = perCallStorefrontId(perCall);
	if (given === null) return;
	if (binding !== null && sameStorefrontId(given, binding.id)) return;
	const situation =
		binding === null
			? "this client is not bound to a campaign storefront"
			: `this client is bound to ${JSON.stringify(binding.id)}`;
	throw new ShopkitConfigError(
		`shopkit: ${operation} was given storefrontId ${JSON.stringify(given)}, but ` +
			`${situation}. ${operation} reuses the cart this client remembers, which ` +
			"was created for one campaign (or for none), so a different campaign " +
			"cannot apply to it. Either configure the campaign on the client — " +
			`createShopkitClient({ storefront: { id: ${JSON.stringify(given)} } }) — so every ` +
			"cart and checkout it makes belongs to it, or create a cart for this " +
			"campaign yourself with cart.create({ storefrontId }) and pass its id as " +
			"`cartId`.",
	);
}

/**
 * The storage prefix a bound client defaults to: `qb_` + the id lower-cased,
 * so a campaign cart never shares a cookie with the shop's ordinary cart or
 * another campaign's.
 */
export function defaultStorefrontStoragePrefix(
	binding: StorefrontBinding,
): string {
	return `qb_${binding.id.toLowerCase()}`;
}

/**
 * The per-call id, trimmed, or null when none was given (including an empty
 * string). A malformed id throws.
 */
function perCallStorefrontId(
	perCall: StorefrontAttribution | undefined,
): string | null {
	const raw = perCall?.storefrontId;
	if (raw === undefined || raw === null) return null;
	const given = typeof raw === "string" ? raw.trim() : raw;
	if (given === "") return null;
	assertStorefrontId(given, "`storefrontId`");
	return given;
}

/** Crockford base32 is case-insensitive, so the platform treats these as one id. */
export function sameStorefrontId(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

function assertStorefrontId(
	value: unknown,
	what: string,
): asserts value is string {
	if (isStorefrontId(value)) return;
	throw new ShopkitConfigError(
		`shopkit: ${what} must be a campaign storefront id — "sf_" followed by 26 ` +
			`Crockford base32 characters, e.g. "sf_01JBQ8ZK4M7XW9YR2TCVN3H5PD" — got ${describeValue(value)}. ` +
			"It is the id shown on the campaign storefront in the Quickbutik admin.",
	);
}

function assertStorefrontSurface(
	value: unknown,
	what: string,
): asserts value is StorefrontSurface {
	if (isStorefrontSurface(value)) return;
	throw new ShopkitConfigError(
		`shopkit: ${what} must be one of ${STOREFRONT_SURFACES.map((s) => `"${s}"`).join(", ")} — got ${describeValue(value)}. ` +
			'Leave it out to send "shopkit".',
	);
}

function describeValue(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (value === undefined) return "undefined";
	if (value === null) return "null";
	return `a ${typeof value}`;
}

// Typed refusals

/**
 * The three ways the platform refuses a campaign storefront checkout, decoded
 * from the machine-readable `details.reason` beside the error message.
 *
 * - `storefront_not_live` (409) — the campaign is not open right now.
 *   `effectiveState` says why: `paused`, `expired`, `coming_soon` (or,
 *   exceptionally, `draft` / `archived`). Show the campaign-closed treatment;
 *   there is nothing for the shopper to fix.
 * - `storefront_quantity_limit` (409) — the cart asks for more of a campaign
 *   line than the merchant allows. `limitType` decides the recovery:
 *   `per_order` means "reduce the quantity to at most `maxQuantity`", `pool`
 *   means the campaign's dedicated stock is down to `maxQuantity` (possibly
 *   0 — sold out). `productId` is the prefixed id (`prod_123`) of the line.
 * - `storefront_mismatch` (400) — the checkout named one campaign
 *   (`storefrontId`) but the cart was created for another
 *   (`cartStorefrontId`). A programming error, not a shopper condition: bind
 *   the client to the campaign, or check out a cart created for it.
 */
export type StorefrontRefusal =
	| {
			reason: "storefront_not_live";
			storefrontId: string | null;
			effectiveState: string;
	  }
	| {
			reason: "storefront_quantity_limit";
			storefrontId: string | null;
			limitType: "per_order" | "pool";
			productId: string | null;
			variantId: number | null;
			maxQuantity: number | null;
	  }
	| {
			reason: "storefront_mismatch";
			storefrontId: string | null;
			cartStorefrontId: string | null;
	  };

/**
 * Narrow any thrown value to a campaign storefront refusal, or `null` when it
 * is something else — a network error, a 404, an ordinary 409 (an out-of-stock
 * line, say).
 *
 * ```ts
 * try {
 *   await shopkit.checkout.start({ successUrl })
 * } catch (error) {
 *   const refusal = storefrontRefusal(error)
 *   if (refusal?.reason === "storefront_not_live") showCampaignClosed(refusal.effectiveState)
 *   else if (refusal?.reason === "storefront_quantity_limit") showLimit(refusal)
 *   else throw error
 * }
 * ```
 *
 * Matches on `details.reason`, not on the HTTP status.
 */
export function storefrontRefusal(error: unknown): StorefrontRefusal | null {
	if (!(error instanceof ShopkitApiError)) return null;
	const details = refusalDetails(error);
	if (!details) return null;
	const storefrontId = pickString(details.storefront_id);

	switch (details.reason) {
		case "storefront_not_live":
			return {
				reason: "storefront_not_live",
				storefrontId,
				effectiveState: pickString(details.effective_state) ?? "unknown",
			};
		case "storefront_quantity_limit": {
			const limitType = details.limit_type;
			return {
				reason: "storefront_quantity_limit",
				storefrontId,
				// The per-order reading is the safer default when the type is missing:
				// "reduce the quantity" is a recovery, "sold out" is a dead end.
				limitType:
					limitType === "per_order" || limitType === "pool"
						? limitType
						: "per_order",
				productId: pickString(details.product_id),
				variantId: pickFiniteNumber(details.variant_id),
				maxQuantity: pickFiniteNumber(details.max_quantity),
			};
		}
		case "storefront_mismatch":
			return {
				reason: "storefront_mismatch",
				storefrontId,
				cartStorefrontId: pickString(details.cart_storefront_id),
			};
		default:
			return null;
	}
}

/**
 * `details` as the transport normalized it, else the raw body's `details`.
 * Anything that is not a plain object is not a refusal.
 */
function refusalDetails(
	error: ShopkitApiError,
): Record<string, unknown> | null {
	const fromError = asRecord(error.details);
	if (fromError?.reason !== undefined) return fromError;
	const body = asRecord(error.body);
	return asRecord(body?.details);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function pickString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function pickFiniteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
