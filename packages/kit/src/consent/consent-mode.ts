import type { ConsentState } from "./types.js";

export type ConsentModeValue = "granted" | "denied";

/**
 * The four Google Consent Mode v2 signals the platform sets: `analytics`
 * drives `analytics_storage`, `marketing` the three advertising signals.
 * `functionality_storage` and `personalization_storage` are not set; push
 * your own `gtag('consent', …)` call if you need them.
 */
export interface ConsentModeSignals {
	analytics_storage: ConsentModeValue;
	ad_storage: ConsentModeValue;
	ad_user_data: ConsentModeValue;
	ad_personalization: ConsentModeValue;
}

/** The signals for a state. Null and undecided are everything denied. */
export function consentModeSignals(
	state: ConsentState | null | undefined,
): ConsentModeSignals {
	const analytics = state?.status === "decided" && state.analytics;
	const marketing = state?.status === "decided" && state.marketing;
	return {
		analytics_storage: value(analytics),
		ad_storage: value(marketing),
		ad_user_data: value(marketing),
		ad_personalization: value(marketing),
	};
}

/**
 * The `consentCategories` value the hosted checkout reads off its URL:
 * - `null`: no signal; the checkout tracks ungated (`requireConsent: false`).
 * - `""`: nothing granted, including undecided.
 * - `"analytics,marketing"`: the granted subset.
 */
export function consentCategoriesParam(
	state: ConsentState | null | undefined,
): string | null {
	if (!state) return null;
	if (state.status !== "decided") return "";
	const granted: string[] = [];
	if (state.analytics) granted.push("analytics");
	if (state.marketing) granted.push("marketing");
	return granted.join(",");
}

function value(granted: boolean): ConsentModeValue {
	return granted ? "granted" : "denied";
}
