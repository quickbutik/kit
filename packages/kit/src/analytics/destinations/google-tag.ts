import { consentModeSignals } from "../../consent/consent-mode.js";
import type { ConsentState } from "../../consent/types.js";
import { isBrowser } from "../../runtime/detect.js";
import type { AnalyticsContext, AnalyticsDestination } from "../destination.js";
import type { CommerceEvent, PurchaseEvent } from "../events.js";
import { purchaseToEvent } from "../events.js";
import { injectScript } from "../script.js";

export interface GoogleTagOptions {
	/** `G-XXXXXXX`. Loads gtag.js and configures the property. */
	ga4MeasurementId?: string | null;
	/** `GTM-XXXXXXX`. Loads the container; events go to the dataLayer. */
	gtmContainerId?: string | null;
	/** `AW-XXXXXXXXX`. Configured on the same gtag.js as GA4. */
	adsConversionId?: string | null;
	/**
	 * Let gtag.js send its automatic `page_view` on load. Default true. A
	 * single-page app that tracks its own navigations sets this false and
	 * calls `analytics.trackPageView()` on every route change instead.
	 */
	sendPageView?: boolean;
	/**
	 * Load GTM / gtag.js before the shopper decides, with Consent Mode
	 * denied (Google's "advanced" mode: cookieless pings). Default false:
	 * nothing from Google loads until `analytics` is granted. Note that a GTM
	 * container loaded this way runs all of its tags before a decision,
	 * gated only by how each tag reads Consent Mode.
	 */
	loadBeforeConsent?: boolean;
	/** GA ids to stitch this page to an existing session (rare). */
	gaLink?: { clientId?: string | null; sessionId?: string | null } | null;
}

type GtagFn = (...args: unknown[]) => void;

interface GoogleWindow extends Window {
	dataLayer?: unknown[];
	gtag?: GtagFn;
}

/** Pushed to the dataLayer on every consent change, for GTM triggers. */
export const CONSENT_UPDATE_EVENT = "qb_consent_update";

/**
 * Ids already set up on this page, so `config` and the GTM bootstrap happen
 * once per id: a second `config` of a GA4 property records a second
 * automatic `page_view`.
 */
const configured = new Set<string>();

function claim(id: string): boolean {
	if (configured.has(id)) return false;
	configured.add(id);
	return true;
}

/**
 * GA4, Google Ads and Google Tag Manager, through one `gtag` and one
 * dataLayer. Consent Mode v2 is set up before any script is injected: a
 * denied `default`, then an `update` if the shopper has already decided.
 * A GTM container may ship its own consent defaults, and a `default` never
 * outranks another `default`; only an `update` does.
 *
 * With a GA4 or Ads id, events go through `gtag('event', …)` (which GTM also
 * sees). With a GTM container only, they are pushed as `{ event, ecommerce }`.
 * Never both, or a container hosting a GA4 tag would count every event twice.
 */
export function googleTagDestination(
	options: GoogleTagOptions,
): AnalyticsDestination {
	const ga4 = clean(options.ga4MeasurementId);
	const gtm = clean(options.gtmContainerId);
	const ads = clean(options.adsConversionId);
	const loadBeforeConsent = options.loadBeforeConsent === true;
	const usesGtag = Boolean(ga4 || ads);
	let loaded = false;

	const send = (event: CommerceEvent): void => {
		if (!loaded || !isBrowser()) return;
		const w = window as GoogleWindow;
		if (usesGtag) {
			ensureGtag(w)("event", event.name, event.params);
			return;
		}
		if (gtm) {
			w.dataLayer = w.dataLayer ?? [];
			// GA4's recommendation: clear ecommerce so items never bleed across events.
			w.dataLayer.push({ ecommerce: null });
			w.dataLayer.push({ event: event.name, ecommerce: event.params });
		}
	};

	return {
		id: "google",
		// Ids only: `config` runs once per id per page, so other options change nothing.
		key: `google:${ga4 ?? ""}|${gtm ?? ""}|${ads ?? ""}`,
		requires: loadBeforeConsent ? null : "analytics",

		load(context: AnalyticsContext): void {
			if (loaded || !isBrowser()) return;
			if (!ga4 && !gtm && !ads) return;
			loaded = true;
			const w = window as GoogleWindow;
			const gtag = ensureGtag(w);

			// Consent first, before anything that could set a cookie.
			gtag("consent", "default", {
				...consentModeSignals(null),
				wait_for_update: 500,
			});
			if (context.consent === null || context.consent.status === "decided") {
				gtag("consent", "update", signalsFor(context.consent));
			}

			if (usesGtag) {
				gtag("js", new Date());
				if (ga4 && claim(ga4)) {
					gtag("config", ga4, {
						send_page_view: options.sendPageView !== false,
						...(options.gaLink?.clientId
							? { client_id: options.gaLink.clientId }
							: {}),
						...(options.gaLink?.sessionId
							? { session_id: options.gaLink.sessionId }
							: {}),
					});
				}
				if (ads && claim(ads)) {
					gtag("config", ads, { allow_enhanced_conversions: true });
				}
				injectScript(
					`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4 ?? (ads as string))}`,
					"google",
				);
			}

			if (gtm && claim(gtm)) {
				// The container replays the dataLayer, consent commands included.
				(w.dataLayer as unknown[]).push({
					"gtm.start": Date.now(),
					event: "gtm.js",
				});
				injectScript(
					`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtm)}`,
					"google",
				);
			}
		},

		onConsent(state: ConsentState | null): void {
			if (!loaded || !isBrowser()) return;
			const w = window as GoogleWindow;
			const gtag = ensureGtag(w);
			gtag("consent", "update", signalsFor(state));
			(w.dataLayer as unknown[]).push({
				event: CONSENT_UPDATE_EVENT,
				qb_consent: {
					status: state?.status ?? "none",
					analytics: state === null || state.analytics,
					marketing: state === null || state.marketing,
				},
			});
		},

		track(event: CommerceEvent): void {
			send(event);
		},

		trackPurchase(purchase: PurchaseEvent): void {
			send(purchaseToEvent(purchase));
		},
	};
}

/**
 * The classic gtag stub, `dataLayer.push(arguments)`, which gtag.js replays
 * when it loads.
 */
function ensureGtag(w: GoogleWindow): GtagFn {
	w.dataLayer = w.dataLayer ?? [];
	if (!w.gtag) {
		w.gtag = function gtag() {
			// biome-ignore lint/complexity/noArguments: gtag.js reads `arguments` back off the dataLayer; a rest array is not the same shape.
			(w.dataLayer as unknown[]).push(arguments);
		};
	}
	return w.gtag;
}

/** Null consent (the hub runs ungated) reads as everything granted. */
function signalsFor(state: ConsentState | null) {
	if (state === null) {
		return {
			analytics_storage: "granted",
			ad_storage: "granted",
			ad_user_data: "granted",
			ad_personalization: "granted",
		} as const;
	}
	return consentModeSignals(state);
}

function clean(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

/** Forget which ids were configured. For tests. */
export function resetGoogleTags(): void {
	configured.clear();
}
