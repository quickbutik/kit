/**
 * The consent categories, matching the hosted storefront, the hosted
 * checkout and Google Consent Mode. `necessary` is never a choice: the cart
 * and checkout session ids the kit stores need no consent.
 */
export type ConsentCategory = "necessary" | "analytics" | "marketing";

/** The two categories a shopper actually decides on. */
export type OptionalConsentCategory = Exclude<ConsentCategory, "necessary">;

/**
 * - `undecided` — no decision stored for the current revision. Everything
 *   optional is treated as denied until the shopper chooses.
 * - `decided` — the shopper chose; `analytics` and `marketing` say what.
 */
export type ConsentStatus = "undecided" | "decided";

/** What a shopper chooses: the optional categories, on or off. */
export interface ConsentChoice {
	analytics: boolean;
	marketing: boolean;
}

/** The persisted decision. Both flags are `false` while `undecided`. */
export interface ConsentState extends ConsentChoice {
	status: ConsentStatus;
	/** ISO 8601, when the shopper decided. Null while undecided. */
	decidedAt: string | null;
	/**
	 * The policy revision the decision was made against. Bump the configured
	 * revision to ask every shopper again.
	 */
	revision: number;
}

/** The decision plus whether the preferences panel is open (not persisted). */
export interface ConsentSnapshot extends ConsentState {
	open: boolean;
}
