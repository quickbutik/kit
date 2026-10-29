import type { ShopTracking } from "../sdk/types/shop.js";
import type { AnalyticsDestination } from "./destination.js";
import {
	type GoogleTagOptions,
	googleTagDestination,
} from "./destinations/google-tag.js";
import { metaPixelDestination } from "./destinations/meta-pixel.js";

export interface DestinationsFromShopOptions {
	/**
	 * Load GTM / gtag.js before a decision, in Consent Mode denied. Default
	 * false. Shorthand for `google: { loadBeforeConsent }`.
	 */
	loadBeforeConsent?: boolean;
	/** Passed through to the Google destination. */
	google?: Omit<
		GoogleTagOptions,
		"ga4MeasurementId" | "gtmContainerId" | "adsConversionId"
	>;
}

/**
 * The destinations a shop's tracking configuration asks for: Google when a
 * GA4 measurement id or a GTM container is set, the Meta Pixel when a pixel
 * id is. These are the ids set in the shop admin, the same ones the hosted
 * checkout reports to. Empty when nothing is configured.
 *
 * `metaCapiEnabled` is ignored: the Conversions API is sent server-side by
 * the platform, not from a storefront.
 */
export function destinationsFromShop(
	tracking: ShopTracking | null | undefined,
	options: DestinationsFromShopOptions = {},
): AnalyticsDestination[] {
	if (!tracking) return [];
	const destinations: AnalyticsDestination[] = [];
	if (tracking.ga4MeasurementId || tracking.gtmContainerId) {
		destinations.push(
			googleTagDestination({
				...(options.loadBeforeConsent !== undefined && {
					loadBeforeConsent: options.loadBeforeConsent,
				}),
				...options.google,
				ga4MeasurementId: tracking.ga4MeasurementId,
				gtmContainerId: tracking.gtmContainerId,
			}),
		);
	}
	if (tracking.metaPixelId) {
		destinations.push(metaPixelDestination({ pixelId: tracking.metaPixelId }));
	}
	return destinations;
}
