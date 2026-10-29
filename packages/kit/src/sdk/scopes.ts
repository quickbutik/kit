import { ShopkitScopeError } from "./errors.js";

/**
 * The scopes a publishable key can carry for a headless storefront. Write
 * scopes for products, orders and customers are merchant-only, and a
 * publishable key presenting them is rejected.
 */
export const SHOPKIT_SCOPES = {
	"products:read": "Read products, variants, images and categories",
	"cart:read": "Read the shopper's cart",
	"cart:write": "Create carts and add/update/remove items",
	"checkout:read": "Read a checkout session and poll its order confirmation",
	"checkout:write": "Create checkout sessions",
	"storefront:read": "Read pages, navigation and theme content",
	"customer:session":
		"Register customers, log them in and out, reset forgotten passwords, and read the logged-in customer's own profile and club points",
	"newsletter:subscribe":
		"Subscribe a shopper's email to the shop's newsletter",
} as const;

export type ShopkitScope = keyof typeof SHOPKIT_SCOPES;

/**
 * The set every storefront needs to browse, build a cart, hand off to the
 * hosted checkout, let customers log in and take newsletter sign-ups. The
 * platform's default publishable-key scopes, minus `storefront:read`.
 */
export const DEFAULT_SHOPKIT_SCOPES: readonly ShopkitScope[] = [
	"products:read",
	"cart:read",
	"cart:write",
	"checkout:read",
	"checkout:write",
	"customer:session",
	"newsletter:subscribe",
];

/**
 * Scope wildcard an admin-grade credential carries. Recognised so a broad test
 * key is not blocked by the local pre-flight check; the API still enforces.
 */
const ADMIN_SCOPE = "admin:full";

export interface ScopeGuard {
	/** The scopes this client was told it has. */
	readonly declared: readonly string[];
	/** Whether local pre-flight checking is on at all. */
	readonly enforced: boolean;
	has(scope: ShopkitScope): boolean;
	/** Throws {@link ShopkitScopeError} when `scope` is not covered. */
	assert(scope: ShopkitScope, operation: string): void;
}

/**
 * Build the pre-flight scope checker. `scopes: null` turns it off, for when
 * the app does not know the key's scopes; the API still enforces them.
 */
export function createScopeGuard(
	scopes: readonly string[] | null | undefined,
): ScopeGuard {
	if (scopes === null) {
		return {
			declared: [],
			enforced: false,
			has: () => true,
			assert: () => undefined,
		};
	}
	const declared = [...(scopes ?? DEFAULT_SHOPKIT_SCOPES)];
	const set = new Set(declared);
	const wildcard = set.has(ADMIN_SCOPE);
	const has = (scope: ShopkitScope): boolean => wildcard || set.has(scope);
	return {
		declared,
		enforced: true,
		has,
		assert: (scope, operation) => {
			if (!has(scope)) throw new ShopkitScopeError(scope, declared, operation);
		},
	};
}
