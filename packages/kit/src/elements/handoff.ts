import { checkoutHandoffUrl } from "../analytics/handoff.js";
import { getAmbientConsent, isConsentDisabled } from "./consent-context.js";
import type { ShopContextValue } from "./shop-context.js";

/**
 * A checkout handoff with the shopper's consent on its URL. Applied by every
 * element that sends the shopper to the hosted checkout, before it emits
 * `qb:checkout-started` or navigates.
 *
 * The URL is left untouched when consent is turned off
 * (`configure({ consent: false })`); see `checkoutHandoffUrl`.
 */
export function decorateHandoff<T extends { url: string }>(
	result: T,
	shop: ShopContextValue | null | undefined,
): T {
	return {
		...result,
		url:
			isConsentDisabled() || shop?.client.consent.enabled === false
				? result.url
				: checkoutHandoffUrl(result.url, getAmbientConsent(), shop?.analytics),
	};
}
