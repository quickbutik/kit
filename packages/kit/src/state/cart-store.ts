import type { ShopkitClient } from "../sdk/client.js";
import { isUnusableCartError } from "../sdk/errors.js";
import type {
	BuyNowResult,
	StartCheckoutInput,
} from "../sdk/resources/checkout.js";
import type { AddCartItemInput, Cart } from "../sdk/types/cart.js";

export type CartStatus = "idle" | "loading" | "ready" | "error";

/**
 * A successful change made through this store, with the cart before and
 * after. Not emitted for `load`, `refresh`, `hydrate` or a failed mutation.
 */
export interface CartMutationEvent {
	type: "add" | "update" | "remove" | "clear" | "buy-now";
	before: Cart | null;
	after: Cart | null;
}

export interface CartSnapshot {
	cart: Cart | null;
	status: CartStatus;
	error: Error | null;
	/** Number of mutations in flight — drives an "updating…" affordance. */
	pending: number;
	/** Sum of item quantities; 0 when there is no cart. */
	itemCount: number;
	/**
	 * Bumped once per successful mutation made through this store (`add`,
	 * `updateItem`, `removeItem`, `clear`, `buyNow`), never by `load`,
	 * `refresh` or `hydrate`. Compare across snapshots to tell when this page
	 * changed the cart (see `EmbeddedCheckout.cartUpdated`); the absolute value
	 * means nothing.
	 */
	revision: number;
}

/**
 * Observable cart state shared by every component that asks for it.
 * Framework-free, with an immutable snapshot replaced on every change, so it
 * works with `useSyncExternalStore`.
 */
export class CartStore {
	private listeners = new Set<() => void>();
	private mutationListeners = new Set<(event: CartMutationEvent) => void>();
	private snapshot: CartSnapshot;
	private pending = 0;
	private loadPromise: Promise<Cart | null> | null = null;
	/** The currency the cart was read in; `load()` re-reads after a switch. */
	private loadedFor: string | null | undefined;
	/** Bumped on every currency switch, so a read that straddles one is dropped. */
	private currencyEpoch = 0;
	private stopCurrencyWatch: (() => void) | null = null;
	private stopCustomerWatch: (() => void) | null = null;

	constructor(
		private readonly client: ShopkitClient,
		initialCart: Cart | null = null,
	) {
		this.loadedFor = initialCart ? client.currency : undefined;
		this.snapshot = {
			cart: initialCart,
			status: initialCart ? "ready" : "idle",
			error: null,
			pending: 0,
			itemCount: countItems(initialCart),
			revision: 0,
		};
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		// Watch the client only while subscribed, so a dropped store is not
		// kept alive by its client.
		if (!this.stopCurrencyWatch) {
			this.stopCurrencyWatch = this.client.onCurrencyChange(() =>
				this.onCurrencyChange(),
			);
		}
		// A login or logout can re-price the cart, so re-read as for a currency switch.
		if (!this.stopCustomerWatch) {
			let who = this.client.customers.cacheKey;
			this.stopCustomerWatch = this.client.customers.onChange(() => {
				// A new profile for the same customer is not a reason to re-read.
				const now = this.client.customers.cacheKey;
				if (now === who) return;
				who = now;
				this.onCurrencyChange();
			});
		}
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) {
				this.stopCurrencyWatch?.();
				this.stopCurrencyWatch = null;
				this.stopCustomerWatch?.();
				this.stopCustomerWatch = null;
			}
		};
	};

	/** Re-read the cart in the new currency. A store that never loaded stays idle. */
	private onCurrencyChange(): void {
		this.currencyEpoch += 1;
		if (this.snapshot.status === "idle" && !this.loadPromise) return;
		void this.refresh();
	}

	getSnapshot = (): CartSnapshot => this.snapshot;

	/**
	 * Be told about every successful mutation, with the cart before and after.
	 * Returns the unsubscribe function. See {@link CartMutationEvent}.
	 */
	onMutation(listener: (event: CartMutationEvent) => void): () => void {
		this.mutationListeners.add(listener);
		return () => {
			this.mutationListeners.delete(listener);
		};
	}

	/**
	 * Load the remembered cart if not already loaded. Never creates one.
	 * Concurrent callers share one request.
	 */
	async load(): Promise<Cart | null> {
		if (
			this.snapshot.status === "ready" &&
			this.loadedFor === this.client.currency
		) {
			return this.snapshot.cart;
		}
		if (this.loadPromise) return this.loadPromise;

		this.patch({ status: "loading", error: null });
		const read = this.startRead();
		const currency = this.client.currency;
		this.loadPromise = this.client.cart
			.current()
			.then((cart) => {
				if (this.isSuperseded(read)) return this.snapshot.cart;
				this.loadedFor = currency;
				this.patch({
					cart,
					status: "ready",
					error: null,
					itemCount: countItems(cart),
				});
				return cart;
			})
			.catch((error: unknown) => {
				if (this.isSuperseded(read)) return this.snapshot.cart;
				this.patch({ status: "error", error: toError(error) });
				return null;
			})
			.finally(() => {
				this.loadPromise = null;
			});
		return this.loadPromise;
	}

	/** Re-read from the server, bypassing the "already loaded" short-circuit. */
	async refresh(): Promise<Cart | null> {
		this.patch({ status: "loading", error: null });
		const read = this.startRead();
		const currency = this.client.currency;
		try {
			const cart = await this.client.cart.current();
			if (this.isSuperseded(read)) return this.snapshot.cart;
			this.loadedFor = currency;
			this.patch({
				cart,
				status: "ready",
				error: null,
				itemCount: countItems(cart),
			});
			return cart;
		} catch (error) {
			if (this.isSuperseded(read)) return this.snapshot.cart;
			this.patch({ status: "error", error: toError(error) });
			return null;
		}
	}

	/** What a read must still match when it lands, see {@link isSuperseded}. */
	private startRead(): { epoch: number; revision: number } {
		return { epoch: this.currencyEpoch, revision: this.snapshot.revision };
	}

	/**
	 * A read overtaken by a currency switch (which starts its own refresh) or
	 * by a mutation (whose response is the newer cart). Its result is dropped.
	 */
	private isSuperseded(read: { epoch: number; revision: number }): boolean {
		return (
			read.epoch !== this.currencyEpoch ||
			read.revision !== this.snapshot.revision
		);
	}

	/** Add an item, creating the cart if needed, in one request. */
	async add(item: AddCartItemInput): Promise<Cart | null> {
		return this.mutate("add", () => this.client.cart.add(item));
	}

	async updateItem(itemId: string, quantity: number): Promise<Cart | null> {
		if (quantity <= 0) return this.removeItem(itemId);
		return this.mutate("update", async () => {
			const cartId = await this.requireCartId();
			return this.client.cart.updateItem(cartId, itemId, quantity);
		});
	}

	async removeItem(itemId: string): Promise<Cart | null> {
		return this.mutate("remove", async () => {
			const cartId = await this.requireCartId();
			return this.client.cart.removeItem(cartId, itemId);
		});
	}

	/**
	 * Empty the basket: delete the remembered cart and forget it. A cart the
	 * server already dropped still ends up cleared. A no-op when there is
	 * nothing to clear.
	 */
	async clear(): Promise<void> {
		// A hydrated cart may be on screen with no id in this browser's storage.
		const shown = this.snapshot.cart?.id ?? null;
		if (shown === null && (await this.client.cart.currentId()) === null) {
			return;
		}
		this.pending += 1;
		this.patch({ pending: this.pending });
		try {
			const before = this.snapshot.cart;
			await this.client.cart.clear({ fallbackCartId: shown });
			this.patch({
				cart: null,
				status: "ready",
				error: null,
				itemCount: 0,
				revision: this.snapshot.revision + 1,
			});
			this.notifyMutation({ type: "clear", before, after: null });
		} catch (error) {
			this.patch({ status: "error", error: toError(error) });
		} finally {
			this.pending -= 1;
			this.patch({ pending: this.pending });
		}
	}

	/** Alias of {@link clear}. */
	clearCart = (): Promise<void> => this.clear();

	/**
	 * Add a product and start the checkout (`checkout.buyNow()`), keeping the
	 * store in step. Does not navigate; `useCheckout().buyNow` and
	 * `<qb-buy-now>` do that with the resolved `url`.
	 *
	 * Unlike the other mutations this one throws, since a failed checkout is
	 * not a cart error. The add may have landed before the failure, so the
	 * cart is quietly re-read first.
	 */
	async buyNow(
		item: AddCartItemInput,
		input: StartCheckoutInput,
	): Promise<BuyNowResult> {
		this.pending += 1;
		this.patch({ pending: this.pending });
		const epoch = this.currencyEpoch;
		try {
			const before = this.snapshot.cart;
			const result = await this.client.checkout.buyNow(item, input);
			this.patch({
				cart: result.cart,
				status: "ready",
				error: null,
				itemCount: countItems(result.cart),
				revision: this.snapshot.revision + 1,
			});
			this.notifyMutation({ type: "buy-now", before, after: result.cart });
			// Same as mutate(): a switch while it was out leaves old prices.
			if (epoch !== this.currencyEpoch) void this.resync();
			return result;
		} catch (error) {
			await this.resync();
			throw error;
		} finally {
			this.pending -= 1;
			this.patch({ pending: this.pending });
		}
	}

	/** `refresh()` without touching `status`: no `loading`, and a failure is ignored. */
	private async resync(): Promise<void> {
		const read = this.startRead();
		const currency = this.client.currency;
		try {
			const cart = await this.client.cart.current();
			if (this.isSuperseded(read)) return;
			this.loadedFor = currency;
			this.patch({
				cart,
				status: "ready",
				error: null,
				itemCount: countItems(cart),
			});
		} catch {
			// Keep what the store had; the caller throws the real error.
		}
	}

	/** Adopt a cart fetched elsewhere (an RSC passing its result down). */
	hydrate(cart: Cart | null): void {
		this.loadedFor = this.client.currency;
		this.patch({
			cart,
			status: "ready",
			error: null,
			itemCount: countItems(cart),
		});
	}

	/** The id of the cart being edited — from state, else from storage. */
	private async requireCartId(): Promise<string> {
		const known =
			this.snapshot.cart?.id ?? (await this.client.cart.currentId());
		if (!known) {
			throw new Error(
				"shopkit: there is no cart to modify. Add an item first, or call refresh().",
			);
		}
		return known;
	}

	/**
	 * Run a mutation, tracking it as pending and storing the server's cart.
	 * Errors go on the snapshot rather than being thrown.
	 */
	private async mutate(
		type: CartMutationEvent["type"],
		operation: () => Promise<Cart>,
	): Promise<Cart | null> {
		this.pending += 1;
		this.patch({ pending: this.pending, error: null });
		const epoch = this.currencyEpoch;
		try {
			const before = this.snapshot.cart;
			const cart = await operation();
			if (epoch === this.currencyEpoch) this.loadedFor = this.client.currency;
			this.patch({
				cart,
				status: "ready",
				error: null,
				itemCount: countItems(cart),
				revision: this.snapshot.revision + 1,
			});
			this.notifyMutation({ type, before, after: cart });
			// Prices may be in the old currency; re-read (after the revision bump,
			// or the re-read would count as overtaken).
			if (epoch !== this.currencyEpoch) void this.resync();
			return cart;
		} catch (error) {
			if (isUnusableCartError(error)) {
				// Forget it, so the next add starts a fresh cart.
				await this.client.cart.forgetCurrent().catch(() => undefined);
				this.patch({ cart: null, itemCount: 0 });
			}
			this.patch({ status: "error", error: toError(error) });
			return null;
		} finally {
			this.pending -= 1;
			this.patch({ pending: this.pending });
		}
	}

	private patch(partial: Partial<CartSnapshot>): void {
		this.snapshot = { ...this.snapshot, ...partial };
		for (const listener of this.listeners) listener();
	}

	/** A listener that throws must not break the mutation that already succeeded. */
	private notifyMutation(event: CartMutationEvent): void {
		for (const listener of this.mutationListeners) {
			try {
				listener(event);
			} catch (error) {
				console.error("shopkit: a cart mutation listener threw", error);
			}
		}
	}
}

function countItems(cart: Cart | null): number {
	return cart?.itemCount ?? 0;
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
