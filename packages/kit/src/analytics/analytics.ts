import { undecidedConsent } from "../consent/cookie.js";
import type { ConsentStore } from "../consent/store.js";
import type { ConsentCategory, ConsentState } from "../consent/types.js";
import { hasLocalStorage, isBrowser } from "../runtime/detect.js";
import type { CartMutationEvent, CartStore } from "../state/cart-store.js";
import type { AnalyticsContext, AnalyticsDestination } from "./destination.js";
import {
	type CommerceEvent,
	type CommerceEventParams,
	cartLineDiff,
	itemsParams,
	type PurchaseEvent,
	purchaseDedupKey,
	purchaseEventId,
	purchaseToEvent,
} from "./events.js";

export interface AnalyticsOptions {
	/** Where events go. More can be added later with `addDestination`. */
	destinations?: AnalyticsDestination[];
	/**
	 * The consent decision every destination is gated on. Without a store
	 * (and without `requireConsent: false`) the shopper counts as undecided
	 * forever, so nothing optional is sent.
	 */
	consent?: ConsentStore | null;
	/**
	 * False runs every destination ungated, for a storefront that owes its
	 * shoppers no consent. Default true.
	 */
	requireConsent?: boolean;
	/** The currency for events that carry none. Falls back to the cart's. */
	currency?: string;
	/**
	 * The shop's numeric store id, for the purchase dedup key and Meta
	 * eventID. Falls back to the attached cart's `Cart.storeId`.
	 */
	storeId?: string | number | null;
	/**
	 * How many events are remembered for destinations that cannot receive
	 * them yet (consent pending, config still loading). Default 50, minimum 1.
	 */
	bufferSize?: number;
	/** Log every dispatch to the console. */
	debug?: boolean;
}

interface Entry {
	seq: number;
	event: CommerceEvent;
	purchase?: { purchase: PurchaseEvent; eventId: string };
}

interface Slot {
	destination: AnalyticsDestination;
	loaded: boolean;
	/** The sequence number up to which this destination has been served. */
	cursor: number;
}

/**
 * The hub: one `track()` the storefront calls, fanned out to every
 * destination the shopper's consent allows.
 *
 * Events a destination cannot receive yet (consent undecided, destination
 * added late) are remembered, bounded, and delivered once it can — or
 * dropped when consent is denied. Gating happens at dispatch time, so
 * withdrawing consent stops a destination immediately.
 *
 * Purchases are deduplicated across page loads and carry the platform's Meta
 * `eventID`, so a reloaded thank-you page does not count the order twice.
 */
export class Analytics {
	private slots: Slot[] = [];
	private history: Entry[] = [];
	private seq = 0;
	private started = false;
	private unsubscribeConsent: (() => void) | null = null;
	private detachCart: (() => void) | null = null;
	private lastSignature: string | null = null;
	private trackedPurchases = new Set<string>();
	private warned = false;
	private cartCurrency: string | undefined;
	private cartStoreId: string | undefined;
	private readonly consent: ConsentStore | null;
	/** False when the hub runs ungated (`requireConsent: false`). */
	readonly requireConsent: boolean;
	private readonly bufferSize: number;

	constructor(private readonly options: AnalyticsOptions = {}) {
		this.consent = options.consent ?? null;
		this.requireConsent = options.requireConsent !== false;
		this.bufferSize = Math.max(1, options.bufferSize ?? 50);
		for (const destination of options.destinations ?? []) {
			this.slots.push({ destination, loaded: false, cursor: 0 });
		}
	}

	/**
	 * The decision the hub gates on; null when it runs ungated. With no
	 * consent store this is undecided, never null ("everything granted").
	 */
	get consentState(): ConsentState | null {
		if (!this.requireConsent) return null;
		return this.consent?.getState() ?? undecidedConsent();
	}

	/** Whether a category may be used right now, by the hub's own rule. */
	allows(category: ConsentCategory | null): boolean {
		if (category === null || category === "necessary") return true;
		if (!this.requireConsent) return true;
		return this.consent?.allows(category) ?? false;
	}

	/**
	 * Begin delivering: load what consent allows, subscribe to changes.
	 * Idempotent; `stop()` undoes it.
	 */
	start(): void {
		if (this.started) return;
		this.started = true;
		if (this.requireConsent && !this.consent && !this.warned) {
			this.warned = true;
			console.warn(
				"shopkit: analytics has no consent store, so every shopper counts " +
					"as undecided and nothing optional will be sent. " +
					"Give it one (<ConsentProvider>, configure({ consent }), or " +
					"`new Analytics({ consent })`), or pass `requireConsent: false` " +
					"if this storefront owes its shoppers no consent.",
			);
		}
		if (this.consent && this.requireConsent) {
			this.unsubscribeConsent = this.consent.subscribe(() =>
				this.onConsentChanged(),
			);
		}
		this.lastSignature = signature(this.consentState);
		this.deliver();
	}

	stop(): void {
		if (!this.started) return;
		this.started = false;
		this.unsubscribeConsent?.();
		this.unsubscribeConsent = null;
	}

	/** `stop()`, plus forget the cart and the remembered events. */
	destroy(): void {
		this.stop();
		this.detachCart?.();
		this.detachCart = null;
		this.history = [];
	}

	/**
	 * Add a destination after construction. It receives the events the hub
	 * still remembers, consent permitting.
	 */
	addDestination(destination: AnalyticsDestination): void {
		if (this.slots.some((slot) => slot.destination === destination)) return;
		// A previously removed destination resumes without a replay or reload.
		const retired = this.retired.get(destination);
		this.retired.delete(destination);
		this.slots.push(retired ?? { destination, loaded: false, cursor: 0 });
		if (this.started) this.deliver();
	}

	/**
	 * Stop delivering to a destination. Its script, if it loaded one, stays
	 * on the page (nothing can unload it); it simply receives nothing more.
	 * Adding the same object back resumes it without a replay.
	 */
	removeDestination(destination: AnalyticsDestination): void {
		const index = this.slots.findIndex(
			(slot) => slot.destination === destination,
		);
		if (index === -1) return;
		const [slot] = this.slots.splice(index, 1);
		if (slot) this.retired.set(destination, slot);
	}

	private retired = new WeakMap<AnalyticsDestination, Slot>();

	/** The destinations the hub holds, in order. */
	get destinations(): readonly AnalyticsDestination[] {
		return this.slots.map((slot) => slot.destination);
	}

	/** Record an event and deliver it wherever consent allows. */
	track(event: CommerceEvent): void {
		this.remember({ seq: ++this.seq, event: this.withDefaults(event) });
		if (this.started) this.deliver();
	}

	trackPageView(params: CommerceEventParams = {}): void {
		this.track({ name: "page_view", params });
	}

	/**
	 * Report an order once. Returns false (and sends nothing) when this
	 * browser already reported it, e.g. on a reloaded thank-you page.
	 * `storeId` falls back to the hub's.
	 */
	trackPurchase(
		purchase: PurchaseEvent,
		key: { storeId?: string | number | null; orderNumber?: string | number },
	): boolean {
		const storeId = key.storeId ?? this.storeId ?? "shop";
		const orderNumber = key.orderNumber ?? purchase.transaction_id;
		const dedupKey = purchaseDedupKey(storeId, orderNumber);
		if (!this.claimPurchase(dedupKey)) return false;
		this.remember({
			seq: ++this.seq,
			event: purchaseToEvent(purchase),
			purchase: { purchase, eventId: purchaseEventId(storeId, orderNumber) },
		});
		if (this.started) this.deliver();
		return true;
	}

	/**
	 * Turn the cart store's mutations into `add_to_cart` / `remove_from_cart`
	 * events for the quantities that changed, and learn the shop's currency
	 * and store id from it. Returns the detach function.
	 */
	attachCart(cartStore: CartStore): () => void {
		this.detachCart?.();
		const learn = (): void => {
			const cart = cartStore.getSnapshot().cart;
			if (cart?.currency) this.cartCurrency = cart.currency;
			if (cart?.storeId != null) this.cartStoreId = String(cart.storeId);
		};
		learn();
		const unsubscribe = cartStore.subscribe(learn);
		const off = cartStore.onMutation((mutation) => this.onCart(mutation));
		this.detachCart = () => {
			unsubscribe();
			off();
		};
		return this.detachCart;
	}

	/**
	 * Report a second cart's `add_to_cart` / `remove_from_cart` through this
	 * hub without replacing the cart given to `attachCart`. Returns the
	 * detach function.
	 */
	observeCart(cartStore: CartStore): () => void {
		return cartStore.onMutation((mutation) => this.onCart(mutation));
	}

	private onCart(mutation: CartMutationEvent): void {
		const { added, removed, currency } = cartLineDiff(
			mutation.before,
			mutation.after,
		);
		if (added.length > 0) {
			this.track({ name: "add_to_cart", params: itemsParams(added, currency) });
		}
		if (removed.length > 0) {
			this.track({
				name: "remove_from_cart",
				params: itemsParams(removed, currency),
			});
		}
	}

	private onConsentChanged(): void {
		const state = this.consentState;
		const next = signature(state);
		if (next === this.lastSignature) return;
		this.lastSignature = next;
		this.deliver();
		const context = this.context();
		for (const slot of this.slots) {
			if (slot.loaded) slot.destination.onConsent?.(state, context);
		}
	}

	private deliver(): void {
		if (!this.started) return;
		const context = this.context();
		for (const slot of this.slots) {
			if (!this.allows(slot.destination.requires)) {
				// Denied: skip what happened so far, even if granted later.
				// Undecided: it waits, and gets everything on a yes.
				if (context.consent?.status === "decided") slot.cursor = this.seq;
				continue;
			}
			if (!slot.loaded) {
				slot.loaded = true;
				try {
					slot.destination.load?.(context);
				} catch (error) {
					console.error(
						`shopkit: analytics destination "${slot.destination.id}" failed to load`,
						error,
					);
				}
			}
			for (const entry of this.history) {
				if (entry.seq <= slot.cursor) continue;
				slot.cursor = entry.seq;
				this.send(slot.destination, entry, context);
			}
		}
	}

	private send(
		destination: AnalyticsDestination,
		entry: Entry,
		context: AnalyticsContext,
	): void {
		if (this.options.debug) {
			console.debug(`shopkit: analytics → ${destination.id}`, entry.event);
		}
		try {
			if (entry.purchase && destination.trackPurchase) {
				destination.trackPurchase(
					entry.purchase.purchase,
					{ eventId: entry.purchase.eventId },
					context,
				);
			} else {
				destination.track(entry.event, context);
			}
		} catch (error) {
			console.error(
				`shopkit: analytics destination "${destination.id}" threw on ${entry.event.name}`,
				error,
			);
		}
	}

	private remember(entry: Entry): void {
		this.history.push(entry);
		while (this.history.length > this.bufferSize) {
			this.history.shift();
		}
	}

	private withDefaults(event: CommerceEvent): CommerceEvent {
		const currency = this.currency;
		if (event.params.currency !== undefined || !currency) return event;
		const needsCurrency =
			event.params.value !== undefined ||
			(Array.isArray(event.params.items) && event.params.items.length > 0);
		if (!needsCurrency) return event;
		return { ...event, params: { ...event.params, currency } };
	}

	private get currency(): string | undefined {
		return this.options.currency ?? this.cartCurrency;
	}

	private get storeId(): string | null {
		const storeId = this.options.storeId ?? this.cartStoreId;
		return storeId == null ? null : String(storeId);
	}

	private context(): AnalyticsContext {
		return {
			consent: this.consentState,
			storeId: this.storeId,
			currency: this.currency,
		};
	}

	private claimPurchase(key: string): boolean {
		if (this.trackedPurchases.has(key)) return false;
		if (isBrowser() && hasLocalStorage()) {
			try {
				if (window.localStorage.getItem(key)) {
					this.trackedPurchases.add(key);
					return false;
				}
				window.localStorage.setItem(key, String(Date.now()));
			} catch {
				// Fall through to the in-memory claim.
			}
		}
		this.trackedPurchases.add(key);
		return true;
	}
}

function signature(state: ConsentState | null): string {
	if (state === null) return "ungated";
	return `${state.status}:${state.analytics ? 1 : 0}${state.marketing ? 1 : 0}`;
}
