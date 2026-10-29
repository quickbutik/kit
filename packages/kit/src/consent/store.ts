import { isBrowser } from "../runtime/detect.js";
import {
	type ConsentCookieWriteOptions,
	clearConsentCookie,
	DEFAULT_CONSENT_REVISION,
	readConsentCookie,
	undecidedConsent,
	writeConsentCookie,
} from "./cookie.js";
import type {
	ConsentCategory,
	ConsentChoice,
	ConsentSnapshot,
	ConsentState,
} from "./types.js";

export interface ConsentStoreOptions extends ConsentCookieWriteOptions {
	/**
	 * Write the decision to the cookie. Default true. Set false when another
	 * system (e.g. a third-party consent platform) owns persistence.
	 */
	persist?: boolean;
	/**
	 * The state to start from instead of reading the cookie, e.g. the result
	 * of `readConsentCookie()` on the server. `null` starts undecided without
	 * reading the cookie.
	 */
	initialState?: ConsentState | null;
}

/** The DOM event dispatched on `document` after every decision. */
export const CONSENT_EVENT = "qb:consent";

/**
 * The shopper's consent decision, observable. One per page, shared by the
 * banner, settings link, gates and analytics hub. Same `subscribe` /
 * `getSnapshot` shape as `CartStore`.
 *
 * The cookie is the source of truth: it is read once at construction (unless
 * `initialState` is given) and written by `save()`.
 */
export class ConsentStore {
	private listeners = new Set<() => void>();
	private snapshot: ConsentSnapshot;
	private touched = false;
	private readonly options: ConsentStoreOptions;
	readonly revision: number;

	constructor(options: ConsentStoreOptions = {}) {
		this.options = options;
		this.revision = options.revision ?? DEFAULT_CONSENT_REVISION;
		const initial =
			options.initialState !== undefined
				? (options.initialState ?? undecidedConsent(this.revision))
				: isBrowser()
					? readConsentCookie(document.cookie, {
							cookieName: options.cookieName,
							revision: this.revision,
						})
					: undecidedConsent(this.revision);
		this.snapshot = { ...withRevision(initial, this.revision), open: false };
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = (): ConsentSnapshot => this.snapshot;

	/** True while no decision has been saved, reset or hydrated since construction. */
	get pristine(): boolean {
		return !this.touched;
	}

	/** The decision alone, without the UI flag — what gets persisted and forwarded. */
	getState(): ConsentState {
		const { open: _open, ...state } = this.snapshot;
		return state;
	}

	/** Whether a category may be used now. `necessary` always; others only after an explicit yes. */
	allows(category: ConsentCategory): boolean {
		if (category === "necessary") return true;
		return this.snapshot.status === "decided" && this.snapshot[category];
	}

	acceptAll(): void {
		this.save({ analytics: true, marketing: true });
	}

	/** Necessary only. As prominent a choice as "accept all", by law. */
	rejectAll(): void {
		this.save({ analytics: false, marketing: false });
	}

	/**
	 * Record a decision. Persists it (unless `persist: false`), closes the
	 * preferences panel and dispatches `qb:consent` on `document`.
	 */
	save(choice: ConsentChoice): void {
		const state: ConsentState = {
			status: "decided",
			analytics: Boolean(choice.analytics),
			marketing: Boolean(choice.marketing),
			decidedAt: new Date().toISOString(),
			revision: this.revision,
		};
		if (this.options.persist !== false) {
			writeConsentCookie(state, this.cookieOptions());
		}
		this.patch({ ...state, open: false });
		this.announce(state);
	}

	/**
	 * Withdraw consent: forget the decision and ask again. Nothing optional
	 * fires until the next decision; scripts already loaded stay on the page
	 * but receive nothing more.
	 */
	reset(): void {
		if (this.options.persist !== false) {
			clearConsentCookie(this.cookieOptions());
		}
		const state = undecidedConsent(this.revision);
		this.patch({ ...state, open: false });
		this.announce(state);
	}

	openSettings(): void {
		if (!this.snapshot.open) this.patch({ open: true });
	}

	closeSettings(): void {
		if (this.snapshot.open) this.patch({ open: false });
	}

	/** Adopt a state read elsewhere (e.g. on the server). Does not persist or announce. */
	hydrate(state: ConsentState | null): void {
		this.patch({
			...withRevision(state ?? undecidedConsent(this.revision), this.revision),
		});
	}

	/** Re-read `document.cookie`, for a page that knows another tab decided. */
	reload(): void {
		if (!isBrowser()) return;
		this.hydrate(
			readConsentCookie(document.cookie, {
				cookieName: this.options.cookieName,
				revision: this.revision,
			}),
		);
	}

	private cookieOptions(): ConsentCookieWriteOptions {
		const { cookieName, maxAgeDays, domain, sameSite, secure } = this.options;
		return {
			cookieName,
			maxAgeDays,
			domain,
			sameSite,
			secure,
			revision: this.revision,
		};
	}

	private announce(state: ConsentState): void {
		if (typeof document === "undefined") return;
		document.dispatchEvent(
			new CustomEvent<ConsentState>(CONSENT_EVENT, { detail: state }),
		);
	}

	private patch(partial: Partial<ConsentSnapshot>): void {
		if ("status" in partial) this.touched = true;
		this.snapshot = { ...this.snapshot, ...partial };
		for (const listener of this.listeners) listener();
	}
}

/** A state for another revision is not a decision for this one. */
function withRevision(state: ConsentState, revision: number): ConsentState {
	if (state.status === "decided" && state.revision !== revision) {
		return undecidedConsent(revision);
	}
	return { ...state, revision };
}
