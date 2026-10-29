import { ShopkitConfigError } from "./errors.js";

/** Prefix every Quickbutik publishable key carries. */
export const PUBLISHABLE_KEY_PREFIX = "qb_pk_";

export interface ParsedPublishableKey {
	/** The whole key, as it must be sent in `Authorization: Bearer …`. */
	key: string;
	/**
	 * The shop's storage prefix (`101928Y`), as encoded in the key. Not the
	 * numeric shop id; see `ShopkitClient.shopPrefix`.
	 */
	shopPrefix: string;
}

/**
 * Split `qb_pk_<shopPrefix>_<random>` into its parts. A shop prefix never
 * contains `_`, so it is exactly the third segment.
 */
export function parsePublishableKey(key: string): ParsedPublishableKey {
	const trimmed = key.trim();
	if (!trimmed) {
		throw new ShopkitConfigError("shopkit: `publishableKey` is required.");
	}
	if (!trimmed.startsWith(PUBLISHABLE_KEY_PREFIX)) {
		throw new ShopkitConfigError(
			`shopkit: \`publishableKey\` must start with "${PUBLISHABLE_KEY_PREFIX}". ` +
				`Got "${redactKey(trimmed)}". A "qb_pat_…" personal access token is a ` +
				`merchant credential and must never be shipped to a storefront.`,
		);
	}
	const parts = trimmed.split("_");
	// ["qb", "pk", shopPrefix, ...random]
	const shopPrefix = parts[2];
	const random = parts.slice(3).join("_");
	if (!shopPrefix || !random) {
		throw new ShopkitConfigError(
			"shopkit: `publishableKey` is malformed — expected qb_pk_<shopPrefix>_<secret>.",
		);
	}
	return { key: trimmed, shopPrefix };
}

/**
 * A key with its secret portion masked, safe to put in an error message or a
 * log line. The shop prefix is kept: it is not a secret and it is the one part
 * that makes a message actionable.
 */
export function redactKey(key: string): string {
	const parts = key.split("_");
	if (parts.length < 4) return `${key.slice(0, 8)}…`;
	return `${parts.slice(0, 3).join("_")}_${"…".padStart(4, "•")}`;
}
