"use client";

import {
	type ButtonHTMLAttributes,
	type ChangeEvent,
	createContext,
	type MouseEvent,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { undecidedConsent } from "../consent/cookie.js";
import { type ConsentLabels, consentLabels } from "../consent/labels.js";
import { ConsentStore, type ConsentStoreOptions } from "../consent/store.js";
import { CONSENT_STYLE_ID, CONSENT_STYLES } from "../consent/styles.js";
import type {
	ConsentCategory,
	ConsentChoice,
	ConsentSnapshot,
	ConsentState,
} from "../consent/types.js";
import { ShopkitConfigError } from "../sdk/errors.js";

export interface ConsentContextValue {
	store: ConsentStore;
	/**
	 * The snapshot a server render and its hydration pass read. One stable
	 * object per provider: `useSyncExternalStore` compares it by identity.
	 */
	serverSnapshot: ConsentSnapshot;
	/**
	 * True when the provider was handed `initialState`, so the first paint can
	 * show the right banner state without waiting for hydration.
	 */
	knownOnServer: boolean;
	/** The provider's `lang`: the default for every banner and button below. */
	lang?: string | null;
	/**
	 * Mounted `<ConsentBanner>`s, counted so the default banner steps aside for
	 * one the page renders itself. Absent on a context value built by hand.
	 */
	banners?: BannerRegistry;
}

/** A count of mounted banners, observable. @internal */
export interface BannerRegistry {
	subscribe: (listener: () => void) => () => void;
	count: () => number;
	register: () => () => void;
}

function createBannerRegistry(): BannerRegistry {
	let mounted = 0;
	const listeners = new Set<() => void>();
	const notify = (): void => {
		for (const listener of listeners) listener();
	};
	return {
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		count: () => mounted,
		register: () => {
			mounted++;
			notify();
			let done = false;
			return () => {
				if (done) return;
				done = true;
				mounted--;
				notify();
			};
		},
	};
}

export const ConsentContext = createContext<ConsentContextValue | null>(null);

export interface ConsentProviderProps extends ConsentStoreOptions {
	children: ReactNode;
	/**
	 * A store you built yourself — one shared with a non-React part of the
	 * page, or a bridge to a third-party consent platform
	 * (`new ConsentStore({ persist: false })` driven from its callback).
	 * Mutually exclusive with the store options; when given, they are ignored.
	 */
	store?: ConsentStore;
	/**
	 * The language of the built-in copy for every `<ConsentBanner>` and
	 * `<ConsentSettingsButton>` below that does not set its own. Set it when
	 * rendering on the server, so both sides pick the same copy.
	 */
	lang?: string | null;
}

/**
 * The shopper's cookie consent, for everything below it.
 *
 * Independent of `<ShopkitProvider>` (a decision is per page, not per shop),
 * so it can sit above or below it. The store is created once and read from
 * the `qb_consent` cookie in the browser.
 *
 * ```tsx
 * <ConsentProvider revision={2}>
 *   <ShopkitProvider config={config}>
 *     <AnalyticsProvider>{children}</AnalyticsProvider>
 *   </ShopkitProvider>
 *   <ConsentBanner lang="sv" privacyPolicyUrl="/privacy" />
 * </ConsentProvider>
 * ```
 *
 * When rendering on the server, read the cookie there and pass it down so the
 * first byte carries the right banner state:
 *
 * ```tsx
 * const consent = readConsentCookie(request.headers.get("cookie"), { revision: 2 })
 * <ConsentProvider revision={2} initialState={consent}>…</ConsentProvider>
 * ```
 *
 * Without `initialState` the server renders as undecided and the banner waits
 * for hydration before showing anything.
 */
export function ConsentProvider({
	children,
	store,
	lang,
	...options
}: ConsentProviderProps): ReactNode {
	// One store per page: a nested provider shares the outer store and banner
	// registry, so its banner replaces the default one.
	const outer = useContext(ConsentContext);
	const joined = useRef<ConsentContextValue | null>(null);
	// A ref, not useMemo: the options are an inline literal, and a rebuilt store
	// would lose the open settings panel and re-read the cookie.
	const created = useRef<ConsentContextValue | null>(null);
	// A nested `initialState` reaches the shared store here, after render, and
	// only while it knows nothing yet (see `adoptIntoOuter`).
	const initialState = options.initialState;
	useBeforePaint(() => {
		if (!outer || initialState === undefined) return;
		applyNestedInitialState(outer.store, initialState);
	}, [outer, initialState]);
	if (outer) {
		if (!joined.current) adoptIntoOuter(outer, store, options);
		const ownLang = lang ?? outer.lang;
		if (
			!joined.current ||
			joined.current.store !== outer.store ||
			joined.current.lang !== ownLang ||
			joined.current.serverSnapshot !== outer.serverSnapshot
		) {
			joined.current = { ...outer, lang: ownLang };
		}
		return (
			<ConsentContext.Provider value={joined.current}>
				{children}
			</ConsentContext.Provider>
		);
	}
	if (!created.current || (store && created.current.store !== store)) {
		const resolved = store ?? new ConsentStore(options);
		const knownOnServer = !store && options.initialState !== undefined;
		created.current = {
			store: resolved,
			// With `initialState` both sides build the store from the same state, so
			// its first snapshot is the server snapshot; without it, undecided.
			serverSnapshot: knownOnServer
				? resolved.getSnapshot()
				: { ...undecidedConsent(resolved.revision), open: false },
			knownOnServer,
			lang,
			banners: created.current?.banners ?? createBannerRegistry(),
		};
	} else if (created.current.lang !== lang) {
		created.current = { ...created.current, lang };
	}
	return (
		<ConsentContext.Provider value={created.current}>
			{children}
		</ConsentContext.Provider>
	);
}

/** The ignored-option lists already warned about, each once. */
const warnedAboutNested = new Set<string>();

/** A state read on the server, as the snapshot a store of `store`'s revision would start from. */
function serverSnapshotFor(
	state: ConsentState | null,
	store: ConsentStore,
): ConsentSnapshot {
	const known =
		state && state.status === "decided" && state.revision === store.revision;
	return known
		? { ...state, open: false }
		: { ...undecidedConsent(store.revision), open: false };
}

/**
 * A layout effect in the browser, so a store that adopts a nested
 * `initialState` does so before the first paint (no banner flash), and a
 * plain effect on the server, where layout effects do not run.
 */
const useBeforePaint =
	typeof window === "undefined" ? useEffect : useLayoutEffect;

function applyNestedInitialState(
	store: ConsentStore,
	state: ConsentState | null,
): void {
	if (!state || state.status !== "decided") return;
	const current = store.getSnapshot();
	if (
		store.pristine &&
		current.status === "undecided" &&
		state.revision === store.revision
	) {
		store.hydrate(state);
		return;
	}
	const same =
		current.status === "decided" &&
		current.analytics === state.analytics &&
		current.marketing === state.marketing;
	if (!same) warnNested(["initialState"]);
}

function warnNested(ignored: string[]): void {
	const key = ignored.join(",");
	if (ignored.length === 0 || warnedAboutNested.has(key)) return;
	warnedAboutNested.add(key);
	console.warn(
		"shopkit: this <ConsentProvider> is inside another consent provider (the " +
			"one <ShopkitProvider> mounts by default, or one of your own) and " +
			`shares its store, so its ${ignored.map((key) => `\`${key}\``).join(", ")} ` +
			"cannot apply. A page has one consent decision: configure it on the " +
			"outer provider (`consent={{ … }}` on <ShopkitProvider>), or set the " +
			"revision and cookie name in the client config (`consent: { revision }`).",
	);
}

function adoptIntoOuter(
	outer: ConsentContextValue,
	store: ConsentStore | undefined,
	options: ConsentStoreOptions,
): void {
	const { initialState, ...rest } = options;
	const ignored = Object.entries(rest)
		.filter(
			([key, value]) =>
				value !== undefined &&
				!(key === "revision" && value === outer.store.revision),
		)
		.map(([key]) => key);
	if (store !== undefined && store !== outer.store) ignored.unshift("store");
	if (initialState !== undefined && !outer.knownOnServer) {
		// The outer provider could not know the decision on the server, and this
		// one can. Only the server snapshot takes it during render (writing the
		// store would update other components mid-render); `applyNestedInitialState`
		// updates the store after. Mutated in place because the default banner,
		// rendered after this subtree, reads the outer value.
		outer.serverSnapshot = serverSnapshotFor(initialState, outer.store);
		outer.knownOnServer = true;
	}
	warnNested(ignored);
}

export interface UseConsentResult extends ConsentSnapshot {
	store: ConsentStore;
	/** Whether a category may be used right now. `necessary` always may; undecided is a no. */
	allows: (category: ConsentCategory) => boolean;
	acceptAll: () => void;
	/** Necessary only. */
	rejectAll: () => void;
	save: (choice: ConsentChoice) => void;
	/** Withdraw: forget the decision, ask again. */
	reset: () => void;
	/** Open the preferences panel — from a footer "Cookie settings" link, say. */
	openSettings: () => void;
	closeSettings: () => void;
}

const subscribeToNothing = (): (() => void) => () => {};
const readNothing = (): null => null;

/**
 * The consent decision and the actions on it. Throws outside a
 * `<ConsentProvider>`.
 *
 * ```tsx
 * const { allows, openSettings } = useConsent()
 * {allows("marketing") ? <TrustpilotWidget /> : null}
 * <button type="button" onClick={openSettings}>Cookie settings</button>
 * ```
 */
export function useConsent(): UseConsentResult {
	const value = useContext(ConsentContext);
	if (!value) {
		throw new ShopkitConfigError(
			"shopkit: no <ConsentProvider> above this component. Wrap the page " +
				"(or the subtree that needs consent) in one.",
		);
	}
	return useConsentFrom(value) as UseConsentResult;
}

/** `useConsent()` when there is a provider above, null when there is not. */
export function useOptionalConsent(): UseConsentResult | null {
	return useConsentFrom(useContext(ConsentContext));
}

/**
 * The store alone, without subscribing to it. For code that reads the
 * decision at call time (a checkout handoff) and must not re-render on every
 * change.
 */
export function useOptionalConsentStore(): ConsentStore | null {
	return useContext(ConsentContext)?.store ?? null;
}

/** Shared by both hooks so each calls the same hooks in the same order. */
function useConsentFrom(
	value: ConsentContextValue | null,
): UseConsentResult | null {
	const store = value?.store ?? null;
	const snapshot = useSyncExternalStore<ConsentSnapshot | null>(
		store ? store.subscribe : subscribeToNothing,
		store ? store.getSnapshot : readNothing,
		value ? () => value.serverSnapshot : readNothing,
	);
	return useMemo<UseConsentResult | null>(() => {
		if (!store || !snapshot) return null;
		return {
			...snapshot,
			store,
			// Derived from the rendered snapshot, not asked of the store, so what a
			// component shows and what it gates on come from the same render.
			allows: (category) =>
				category === "necessary" ||
				(snapshot.status === "decided" && snapshot[category]),
			acceptAll: () => store.acceptAll(),
			rejectAll: () => store.rejectAll(),
			save: (choice) => store.save(choice),
			reset: () => store.reset(),
			openSettings: () => store.openSettings(),
			closeSettings: () => store.closeSettings(),
		};
	}, [store, snapshot]);
}

const readDocumentLang = (): string | null =>
	document.documentElement?.lang?.trim() || null;
const readNoLang = (): null => null;

/**
 * The language for the built-in copy. Without an explicit one, the server and
 * hydration pass render English and only then follow `<html lang>`, so the
 * copy cannot mismatch during hydration.
 */
function useLabelLanguage(lang: string | null | undefined): string {
	const documentLang = useSyncExternalStore(
		subscribeToNothing,
		readDocumentLang,
		readNoLang,
	);
	return lang?.trim() || documentLang || "en";
}

function useIsHydrated(): boolean {
	return useSyncExternalStore(
		subscribeToNothing,
		() => true,
		() => false,
	);
}

export interface ConsentBannerState extends ConsentSnapshot {
	/** Whether the banner should be on screen: undecided, settings open, or `showWhenDecided`. */
	visible: boolean;
	labels: ConsentLabels;
	/** The choices in the preferences panel, before they are saved. */
	draft: ConsentChoice;
	setDraft: (partial: Partial<ConsentChoice>) => void;
	acceptAll: () => void;
	rejectAll: () => void;
	/** Save the draft. */
	save: () => void;
	reset: () => void;
	openSettings: () => void;
	closeSettings: () => void;
}

export interface ConsentBannerProps {
	/**
	 * Language of the built-in copy (`"sv"`, `"en"`, `"da"`, `"nb"`, `"fi"`).
	 * Defaults to the provider's `lang`, then `<html lang>` in the browser,
	 * then English. Set it when rendering on the server.
	 */
	lang?: string | null;
	/** Overrides for any of the built-in strings. */
	labels?: Partial<ConsentLabels> | null;
	/** Adds a "Privacy policy" link to the description. */
	privacyPolicyUrl?: string | null;
	/** Extra class on the default markup's root. */
	className?: string;
	/**
	 * Leave out the built-in stylesheet; the default markup keeps its
	 * `qb-consent*` class names (plus `qb-consent--unstyled`). Default false.
	 */
	unstyled?: boolean;
	/**
	 * Keep rendering after a decision — for a cookie settings page, where the
	 * shopper should always be able to change their mind. Default false: the
	 * banner leaves once a decision exists and comes back on `openSettings()`.
	 */
	showWhenDecided?: boolean;
	/**
	 * Your own markup, given the state. When present, the default markup is
	 * not rendered.
	 */
	children?: (state: ConsentBannerState) => ReactNode;
}

/**
 * The cookie banner.
 *
 * Headless first: hand it a render function and it renders exactly that,
 * with the state and the actions a banner needs — the choices as a `draft`,
 * `save()` to store them, `acceptAll()` / `rejectAll()` for the two buttons
 * every banner has.
 *
 * ```tsx
 * <ConsentBanner>
 *   {({ visible, labels, draft, setDraft, acceptAll, rejectAll, save, open, openSettings }) => (
 *     <aside className="my-banner">
 *       <p>{labels.description}</p>
 *       {open ? (
 *         <label>
 *           <input type="checkbox" checked={draft.analytics}
 *                  onChange={(e) => setDraft({ analytics: e.target.checked })} />
 *           {labels.analytics}
 *         </label>
 *       ) : null}
 *       <button onClick={rejectAll}>{labels.rejectAll}</button>
 *       <button onClick={acceptAll}>{labels.acceptAll}</button>
 *     </aside>
 *   )}
 * </ConsentBanner>
 * ```
 *
 * Without children it renders a minimal, accessible dialog. Its stylesheet sits
 * in `@layer qb-consent`, themed through `--qb-consent-*` custom properties, and
 * targets the stable `qb-consent*` class names, so a site's own CSS wins;
 * `unstyled` leaves it out. Accept-all and reject-all are equally prominent.
 * The copy comes from `consentLabels(lang, labels)`.
 *
 * Inside a `<ShopkitProvider>` that shows the default banner, this replaces it.
 *
 * It renders nothing once the shopper has decided (unless `showWhenDecided`)
 * and reappears on `openSettings()` or `reset()`. Without `initialState` on the
 * provider it renders nothing until hydrated, so it never flashes.
 */
export function ConsentBanner(props: ConsentBannerProps): ReactNode {
	const context = useContext(ConsentContext);
	if (!context) {
		throw new ShopkitConfigError(
			"shopkit: <ConsentBanner> needs a <ConsentProvider> above it.",
		);
	}
	// Counted, so the default banner steps aside for this one.
	const registry = context.banners;
	useEffect(() => registry?.register(), [registry]);
	return <ConsentBannerView context={context} {...props} />;
}

/**
 * The banner `<ShopkitProvider>` renders on its own: the default dialog, or
 * the provider's render prop, unless the page mounts a `<ConsentBanner>` of
 * its own somewhere below, which then wins. @internal
 */
export function DefaultConsentBanner(props: ConsentBannerProps): ReactNode {
	const context = useContext(ConsentContext);
	const registry = context?.banners;
	const explicit = useSyncExternalStore(
		registry ? registry.subscribe : subscribeToNothing,
		registry ? registry.count : countNothing,
		countNothing,
	);
	if (!context || explicit > 0) return null;
	return <ConsentBannerView context={context} {...props} />;
}

const countNothing = (): number => 0;

function ConsentBannerView({
	context,
	lang: ownLang,
	labels: overrides,
	privacyPolicyUrl,
	className,
	unstyled = false,
	showWhenDecided = false,
	children,
}: ConsentBannerProps & { context: ConsentContextValue }): ReactNode {
	const lang = useLabelLanguage(ownLang ?? context.lang);
	const consent = useConsentFrom(context) as UseConsentResult;
	const hydrated = useIsHydrated();
	const id = useId();
	const { status, open, analytics, marketing } = consent;

	// Re-seeded from the stored decision each time the panel opens. Adjusted
	// during render rather than in an effect, so no frame shows a stale draft.
	const [draft, setDraftState] = useState<ConsentChoice>({
		analytics,
		marketing,
	});
	const [seededFor, setSeededFor] = useState(open);
	if (open !== seededFor) {
		setSeededFor(open);
		if (open) setDraftState({ analytics, marketing });
	}

	// Keyed on the serialized overrides: an inline literal would otherwise make
	// `state` below new on every render.
	const serializedOverrides = JSON.stringify(overrides ?? null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the serialized key IS the dependency.
	const labels = useMemo(
		() => consentLabels(lang, overrides),
		[lang, serializedOverrides],
	);

	const setDraft = useCallback((partial: Partial<ConsentChoice>) => {
		setDraftState((current) => ({ ...current, ...partial }));
	}, []);

	const visible = status === "undecided" || open || showWhenDecided;

	const state = useMemo<ConsentBannerState>(
		() => ({
			status: consent.status,
			analytics: consent.analytics,
			marketing: consent.marketing,
			decidedAt: consent.decidedAt,
			revision: consent.revision,
			open: consent.open,
			visible,
			labels,
			draft,
			setDraft,
			acceptAll: consent.acceptAll,
			rejectAll: consent.rejectAll,
			save: () => consent.save(draft),
			reset: consent.reset,
			openSettings: consent.openSettings,
			closeSettings: consent.closeSettings,
		}),
		[consent, visible, labels, draft, setDraft],
	);

	// When the panel opens, focus the first enabled choice (default markup only).
	const fieldset = useRef<HTMLFieldSetElement | null>(null);
	const customMarkup = typeof children === "function";
	useEffect(() => {
		if (!open || customMarkup) return;
		fieldset.current
			?.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:disabled)')
			?.focus();
	}, [open, customMarkup]);

	if (!hydrated && !context.knownOnServer) return null;
	if (!visible) return null;
	if (children) return children(state);

	const titleId = `${id}-title`;
	const descriptionId = `${id}-desc`;
	const onToggle =
		(category: keyof ConsentChoice) => (event: ChangeEvent<HTMLInputElement>) =>
			setDraft({ [category]: event.target.checked });

	const classes = ["qb-consent"];
	if (unstyled) classes.push("qb-consent--unstyled");
	if (className) classes.push(className);

	return (
		<>
			{unstyled ? null : (
				// `href` + `precedence` let React 19 hoist this into <head> once and into
				// the server HTML; React 18 renders it in place.
				<style href={CONSENT_STYLE_ID} precedence="qb-consent">
					{CONSENT_STYLES}
				</style>
			)}
			<div
				className={classes.join(" ")}
				role="dialog"
				aria-modal="false"
				aria-labelledby={titleId}
				aria-describedby={descriptionId}
				data-status={status}
				data-open={open ? "true" : "false"}
			>
				<div className="qb-consent__body">
					<h2 className="qb-consent__title" id={titleId}>
						{labels.title}
					</h2>
					<p className="qb-consent__description" id={descriptionId}>
						{labels.description}
						{privacyPolicyUrl ? (
							<>
								{" "}
								<a className="qb-consent__policy" href={privacyPolicyUrl}>
									{labels.privacyPolicy}
								</a>
							</>
						) : null}
					</p>
				</div>
				{open ? (
					<fieldset className="qb-consent__categories" ref={fieldset}>
						<label className="qb-consent__category">
							<input
								type="checkbox"
								checked
								disabled
								readOnly
								data-qb-consent="necessary"
							/>{" "}
							<span className="qb-consent__category-name">
								{labels.necessary}
							</span>{" "}
							<span className="qb-consent__category-description">
								{labels.necessaryDescription}
							</span>
						</label>
						<label className="qb-consent__category">
							<input
								type="checkbox"
								data-qb-consent="analytics"
								checked={draft.analytics}
								onChange={onToggle("analytics")}
							/>{" "}
							<span className="qb-consent__category-name">
								{labels.analytics}
							</span>{" "}
							<span className="qb-consent__category-description">
								{labels.analyticsDescription}
							</span>
						</label>
						<label className="qb-consent__category">
							<input
								type="checkbox"
								data-qb-consent="marketing"
								checked={draft.marketing}
								onChange={onToggle("marketing")}
							/>{" "}
							<span className="qb-consent__category-name">
								{labels.marketing}
							</span>{" "}
							<span className="qb-consent__category-description">
								{labels.marketingDescription}
							</span>
						</label>
					</fieldset>
				) : null}
				<div className="qb-consent__actions">
					{open ? (
						<button
							type="button"
							className="qb-consent__button qb-consent__button--save"
							data-qb-action="save"
							onClick={state.save}
						>
							{labels.save}
						</button>
					) : (
						<button
							type="button"
							className="qb-consent__button qb-consent__button--settings"
							data-qb-action="open-settings"
							onClick={state.openSettings}
						>
							{labels.settings}
						</button>
					)}
					<button
						type="button"
						className="qb-consent__button qb-consent__button--reject"
						data-qb-action="reject-all"
						onClick={state.rejectAll}
					>
						{labels.rejectAll}
					</button>
					<button
						type="button"
						className="qb-consent__button qb-consent__button--accept"
						data-qb-action="accept-all"
						onClick={state.acceptAll}
					>
						{labels.acceptAll}
					</button>
				</div>
			</div>
		</>
	);
}

export interface ConsentGateProps {
	/** The category the content needs. */
	category: ConsentCategory;
	/** Rendered while the category is not allowed. Defaults to nothing. */
	fallback?: ReactNode;
	children: ReactNode;
}

/**
 * Render something only once the shopper has allowed a category — a
 * third-party widget that sets its own cookies, a marketing embed.
 *
 * ```tsx
 * <ConsentGate category="marketing" fallback={<p>Allow marketing cookies to see reviews.</p>}>
 *   <TrustpilotWidget />
 * </ConsentGate>
 * ```
 *
 * Undecided is denied, and so is a server render without `initialState`: the
 * fallback goes out first and the content appears once consent is known.
 */
export function ConsentGate({
	category,
	fallback = null,
	children,
}: ConsentGateProps): ReactNode {
	const { allows } = useConsent();
	return allows(category) ? children : fallback;
}

export interface ConsentSettingsButtonProps
	extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "lang"> {
	/**
	 * Language of the default label ("Cookie settings", "Cookie-inställningar",
	 * …). Defaults to the provider's `lang`, then `<html lang>`.
	 */
	lang?: string | null;
}

/**
 * The "Cookie settings" button for a footer: reopens the banner's preferences
 * panel, so a shopper can change their mind (or withdraw) long after the
 * banner left. The React face of `<qb-consent-settings>`.
 *
 * ```tsx
 * <footer>
 *   <ConsentSettingsButton className="link" />
 *   <ConsentSettingsButton>Ändra cookieval</ConsentSettingsButton>
 * </footer>
 * ```
 *
 * Every other button prop passes through; an `onClick` of your own runs first
 * and can `preventDefault()` to keep the panel shut. Renders nothing without a
 * consent provider above.
 */
export function ConsentSettingsButton({
	lang,
	children,
	onClick,
	...rest
}: ConsentSettingsButtonProps): ReactNode {
	const context = useContext(ConsentContext);
	const store = context?.store ?? null;
	const resolvedLang = useLabelLanguage(lang ?? context?.lang);
	const label = useMemo(
		() => consentLabels(resolvedLang).cookieSettings,
		[resolvedLang],
	);
	if (!store) return null;
	const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
		onClick?.(event);
		if (!event.defaultPrevented) store.openSettings();
	};
	return (
		<button type="button" {...rest} onClick={handleClick}>
			{children ?? label}
		</button>
	);
}
