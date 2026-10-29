"use client";

import { type ReactNode, useContext, useEffect, useMemo, useRef } from "react";
import type { ConsentStore, ConsentStoreOptions } from "../consent/store.js";
import type { ConsentState } from "../consent/types.js";
import { createShopkitClient, type ShopkitClient } from "../sdk/client.js";
import type { ShopkitConfig } from "../sdk/config.js";
import { ShopkitConfigError } from "../sdk/errors.js";
import { sameStorefrontId } from "../sdk/storefront.js";
import type { Cart } from "../sdk/types/cart.js";
import { CartStore } from "../state/cart-store.js";
import {
	AnalyticsContext,
	AnalyticsProvider,
	type AnalyticsProviderProps,
	isHubFor,
} from "./analytics.js";
import {
	type ConsentBannerProps,
	type ConsentBannerState,
	ConsentContext,
	ConsentProvider,
	DefaultConsentBanner,
} from "./consent.js";
import { ShopkitContext, type ShopkitContextValue } from "./context.js";

/** What `consent={{ analytics }}` takes: the `<AnalyticsProvider>` props. */
export type ShopkitAnalyticsOptions = Omit<AnalyticsProviderProps, "children">;

/**
 * The `consent` prop of `<ShopkitProvider>` as an object: the consent store's
 * options, the default banner's, and the analytics switch.
 */
export interface ShopkitConsentOptions
	extends Omit<ConsentStoreOptions, "initialState"> {
	/**
	 * The decision as the server read it (`await shopkit.consent.read()`), so
	 * the first paint shows the right banner state. Without it the banner waits
	 * for hydration.
	 */
	initialState?: ConsentState | null;
	/**
	 * A consent store you built yourself (one shared with a non-React part of
	 * the page, or a bridge to a third-party consent platform). The store
	 * options are then ignored.
	 */
	store?: ConsentStore;
	/**
	 * Language of the built-in copy, for the banner and every
	 * `<ConsentSettingsButton>` below. Set it when rendering on the server.
	 */
	lang?: string | null;
	/** Adds a "Privacy policy" link to the banner. */
	privacyPolicyUrl?: string | null;
	/** Overrides for any of the banner's built-in strings. */
	labels?: ConsentBannerProps["labels"];
	/** Extra class on the default banner's root. */
	className?: string;
	/** Leave out the default banner's stylesheet. */
	unstyled?: boolean;
	/**
	 * The banner. Default true: the kit's accessible dialog. `false` renders
	 * none (render your own with `useConsent()` or `<ConsentBanner>`); a
	 * function is the render prop `<ConsentBanner>` takes, rendered in its
	 * place.
	 */
	banner?: boolean | ((state: ConsentBannerState) => ReactNode);
	/**
	 * The shop's own GA4 / GTM / Meta pixel, gated on this consent. Default
	 * true. `false` keeps the banner and loads no pixel; an object is the
	 * `<AnalyticsProvider>` options (extra `destinations`, `auto: false`, …).
	 */
	analytics?: boolean | ShopkitAnalyticsOptions;
}

export interface ShopkitProviderProps {
	children: ReactNode;
	/** A client you built yourself. Mutually exclusive with `config`. */
	client?: ShopkitClient;
	/** Config for a client the provider builds and owns. */
	config?: ShopkitConfig;
	/**
	 * Sell into this campaign storefront (`sf_…`) — shorthand for
	 * `config.storefrontId`. Every product read, cart and checkout below is
	 * priced for and attributed to the campaign.
	 *
	 * Changing it to a different campaign (ids compare case-insensitively)
	 * rebuilds the client and the cart store, since each campaign has its own
	 * cart. With a prebuilt `client` the prop can only confirm that client's
	 * binding and throws on a mismatch. `null` / `""` mean "not set".
	 */
	storefrontId?: string | null;
	/**
	 * The default currency to browse in — shorthand for `config.currency`. A
	 * currency the shopper picked with `setCurrency()` / `useCurrency()` is
	 * remembered and wins on a later visit.
	 *
	 * A later change switches the client (`setCurrency`) without rebuilding it:
	 * catalog hooks refetch and the same cart is re-read. Changing to `null`
	 * forgets the choice and returns to the value the provider mounted with.
	 * Server-render it from the same remembered value (the `qb_currency` cookie)
	 * so SSR and the first paint agree. With a prebuilt `client`, only later
	 * changes are forwarded.
	 */
	currency?: string | null;
	/**
	 * A cart already fetched on the server, so the first paint shows the real
	 * basket instead of an empty one that fills in a moment later.
	 */
	initialCart?: Cart | null;
	/**
	 * Options for the cookie consent and analytics the provider mounts, which
	 * are on by default: a consent banner, the decision kept in a `qb_consent`
	 * cookie, the shop's own GA4 / GTM / Meta pixel loaded once the shopper
	 * agrees (Meta only on `marketing`), and the decision forwarded to the hosted
	 * checkout. To switch it off, set `consent: false` in the client config.
	 *
	 * Inside a tree that already has consent (your own `<ConsentProvider>` or an
	 * outer `<ShopkitProvider>`), that store and analytics hub are reused and no
	 * second banner is rendered.
	 *
	 * @deprecated `consent={false}` still turns consent off for this tree, but
	 * a server-started checkout does not see the prop and keeps forwarding the
	 * decision; it logs a warning. Set `consent: false` in the config instead.
	 */
	consent?: ShopkitConsentOptions | false;
}

/**
 * Makes one client and one shared cart store available to the tree, and, by
 * default, cookie consent with a banner and the shop's own analytics gated on
 * it (see the `consent` prop).
 *
 * ```tsx
 * <ShopkitProvider config={{ publishableKey }} consent={{ lang: "sv", privacyPolicyUrl: "/integritet" }}>
 *   <App />
 * </ShopkitProvider>
 * ```
 *
 * The client and cart store are created once and kept for the provider's
 * lifetime.
 */
export function ShopkitProvider({
	children,
	client,
	config,
	storefrontId,
	currency,
	initialCart = null,
	consent,
}: ShopkitProviderProps): ReactNode {
	if (!client && !config) {
		throw new Error(
			"shopkit: <ShopkitProvider> needs either a `client` or a `config`.",
		);
	}

	const campaign = typeof storefrontId === "string" ? storefrontId.trim() : "";
	if (client && campaign !== "") assertClientBinding(client, campaign);

	// Refs rather than useMemo deps: `config` is usually an inline literal. Only
	// a different campaign rebuilds the client.
	const clientRef = useRef<ShopkitClient | null>(null);
	const builtFor = useRef<string | null>(null);
	// biome-ignore lint/style/noNonNullAssertion: only read when no client was passed, i.e. config is set.
	const key = client ? "" : campaignKey(campaign, config!);
	if (!client && (!clientRef.current || builtFor.current !== key)) {
		clientRef.current = createShopkitClient(
			// biome-ignore lint/style/noNonNullAssertion: guarded by the check above.
			withCurrency(withCampaign(config!, campaign), currency),
		);
		builtFor.current = key;
	}
	// biome-ignore lint/style/noNonNullAssertion: assigned immediately above when no client was passed.
	const resolvedClient = client ?? clientRef.current!;

	// Keyed by client: each campaign's client has its own cart.
	const storeRef = useRef<{ client: ShopkitClient; store: CartStore } | null>(
		null,
	);
	if (!storeRef.current || storeRef.current.client !== resolvedClient) {
		storeRef.current = {
			client: resolvedClient,
			// `initialCart` belongs to the first client only — it was fetched for
			// the campaign the page was rendered with.
			store: new CartStore(
				resolvedClient,
				storeRef.current ? null : initialCart,
			),
		};
	}
	const cartStore = storeRef.current.store;

	// Only a CHANGE is forwarded: on mount the prop is the client's default
	// (merged into the config above), and pushing it again would overwrite a
	// currency the shopper picked on an earlier visit.
	const lastCurrency = useRef(currency);
	useEffect(() => {
		if (lastCurrency.current === currency) return;
		lastCurrency.current = currency;
		if (currency === undefined) return;
		void resolvedClient.setCurrency(currency);
	}, [currency, resolvedClient]);

	const value = useMemo<ShopkitContextValue>(
		() => ({ client: resolvedClient, cartStore }),
		[resolvedClient, cartStore],
	);

	// Reuse a consent store and hub from above, so a nested provider adds no
	// second banner and loads no pixel twice.
	const outerConsent = useContext(ConsentContext);
	const outerHub = useContext(AnalyticsContext);

	const configOn = resolvedClient.consent.enabled;
	const enabled = configOn && consent !== false;
	const options: ShopkitConsentOptions =
		typeof consent === "object" && consent !== null ? consent : {};
	const analyticsSetting = enabled ? (options.analytics ?? true) : false;
	warnAboutConsentProp(consent, configOn);

	// Consent is per page, analytics per shop: a hub above is shared only when
	// it reports for this provider's shop.
	const sharedHub =
		outerHub && isHubFor(outerHub, resolvedClient) ? outerHub : null;

	// A shared hub hears this provider's cart too. Only when it is someone
	// else's: the hub this provider mounts below attaches the cart itself.
	useEffect(() => {
		if (!sharedHub || !analyticsSetting) return;
		return sharedHub.observeCart(cartStore);
	}, [sharedHub, analyticsSetting, cartStore]);

	let tree = children;
	if (analyticsSetting && !sharedHub) {
		const analyticsOptions =
			typeof analyticsSetting === "object" ? analyticsSetting : {};
		tree = <AnalyticsProvider {...analyticsOptions}>{tree}</AnalyticsProvider>;
	}
	tree = (
		<ShopkitContext.Provider value={value}>{tree}</ShopkitContext.Provider>
	);

	if (!enabled || outerConsent) return tree;

	const {
		analytics: _analytics,
		banner = true,
		lang,
		privacyPolicyUrl,
		labels,
		className,
		unstyled,
		...storeOptions
	} = options;
	return (
		<ConsentProvider
			{...storeOptions}
			revision={storeOptions.revision ?? resolvedClient.consent.revision}
			cookieName={storeOptions.cookieName ?? resolvedClient.consent.cookieName}
			lang={lang}
		>
			{tree}
			{banner === false ? null : (
				<DefaultConsentBanner
					privacyPolicyUrl={privacyPolicyUrl}
					labels={labels}
					className={className}
					unstyled={unstyled}
				>
					{typeof banner === "function" ? banner : undefined}
				</DefaultConsentBanner>
			)}
		</ConsentProvider>
	);
}

let warnedAboutProp = false;
let warnedAboutIgnored = false;

/** The two ways the `consent` prop and the config can disagree, said once. */
function warnAboutConsentProp(
	consent: ShopkitConsentOptions | false | undefined,
	configOn: boolean,
): void {
	if (consent === false && configOn && !warnedAboutProp) {
		warnedAboutProp = true;
		console.warn(
			"shopkit: <ShopkitProvider consent={false}> is deprecated. It turns " +
				"consent off in this React tree only: a checkout started on the " +
				"server (`checkout.start()` in a server action) still forwards the " +
				"shopper's decision. Set `consent: false` in the client config " +
				"instead, which both read.",
		);
	}
	if (typeof consent === "object" && !configOn && !warnedAboutIgnored) {
		warnedAboutIgnored = true;
		console.warn(
			"shopkit: <ShopkitProvider consent={…}> options are ignored because " +
				"the client config says `consent: false`.",
		);
	}
}

/**
 * The campaign the built client sells into, as a rebuild key: the prop, else
 * the config's `storefrontId` or `storefront.id`, lower-cased because the
 * platform compares ids case-insensitively.
 */
function campaignKey(campaign: string, config: ShopkitConfig): string {
	const id =
		campaign ||
		trimmed(config.storefrontId) ||
		trimmed(config.storefront?.id) ||
		"";
	return id.toLowerCase();
}

function trimmed(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/**
 * The config with the `storefrontId` prop merged in. Throws if the config
 * already names a different `storefrontId`, rather than silently replacing it.
 */
function withCampaign(config: ShopkitConfig, campaign: string): ShopkitConfig {
	if (campaign === "") return config;
	const own = trimmed(config.storefrontId);
	if (own !== "" && !sameStorefrontId(own, campaign)) {
		throw new ShopkitConfigError(
			`shopkit: <ShopkitProvider storefrontId=${JSON.stringify(campaign)}> ` +
				`disagrees with its config's storefrontId ${JSON.stringify(own)}. A ` +
				"client sells into exactly one campaign; set it in one place.",
		);
	}
	return { ...config, storefrontId: campaign };
}

/** The config with the `currency` prop merged in; the prop wins. */
function withCurrency(
	config: ShopkitConfig,
	currency: string | null | undefined,
): ShopkitConfig {
	return currency === undefined ? config : { ...config, currency };
}

/**
 * A prebuilt client's campaign is fixed at construction, so the provider
 * cannot rebind it; it throws on a prop that disagrees.
 */
function assertClientBinding(
	client: ShopkitClient,
	storefrontId: string,
): void {
	const bound = client.storefront?.id ?? null;
	if (bound !== null && sameStorefrontId(bound, storefrontId)) return;
	const situation =
		bound === null
			? "that client is not bound to a campaign storefront"
			: `that client is bound to ${JSON.stringify(bound)}`;
	throw new ShopkitConfigError(
		`shopkit: <ShopkitProvider storefrontId=${JSON.stringify(storefrontId)}> ` +
			`was given a prebuilt \`client\`, but ${situation}. A client's campaign ` +
			"is fixed when it is built, so the provider cannot rebind it. Build the " +
			`client with createShopkitClient({ storefrontId: ${JSON.stringify(storefrontId)}, … }), ` +
			"or pass `config` instead of `client` and let the provider build it.",
	);
}
