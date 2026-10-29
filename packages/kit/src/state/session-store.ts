import type { MaybePromise, StorageAdapter } from "../runtime/storage.js";

/**
 * What shopkit remembers between requests: the cart id, the checkout session
 * id, and the shop's numeric store id (twice).
 *
 * All are opaque server-side handles with no prices or PII, so the store is
 * strictly necessary functionality that needs no consent, and clearing it is
 * always a safe recovery. The exception is a logged-in customer's session
 * (`${prefix}_customer_session`), a credential written only after login and
 * removed on logout.
 *
 * The store id is remembered off every cart so `checkout.hostedUrl()` can
 * stay synchronous. One copy lives with the cart id (cart TTL), one with the
 * checkout session (session TTL). Forgetting the cart keeps both, so a
 * reloaded thank-you page still keys its `purchase` event on the same id
 * after the order has consumed the cart. Only `clear()` forgets them.
 */
export class SessionStore {
	private readonly cartKey: string;
	private readonly sessionKey: string;
	private readonly storeKey: string;
	private readonly checkoutStoreKey: string;
	private readonly customerKey: string;
	/** In memory too, since some adapters can only be read asynchronously. */
	private lastStoreId: string | null = null;
	/** The store id recorded with the checkout session, in memory. */
	private lastCheckoutStoreId: string | null = null;

	constructor(
		readonly storage: StorageAdapter,
		prefix: string,
		private readonly ttlSeconds: number,
	) {
		this.cartKey = `${prefix}_cart_id`;
		this.sessionKey = `${prefix}_checkout_session`;
		this.storeKey = `${prefix}_store_id`;
		this.checkoutStoreKey = `${prefix}_checkout_store`;
		this.customerKey = `${prefix}_customer_session`;
	}

	async getCartId(): Promise<string | null> {
		return normalize(await this.storage.get(this.cartKey));
	}

	async setCartId(cartId: string): Promise<void> {
		await this.storage.set(this.cartKey, cartId, {
			ttlSeconds: this.ttlSeconds,
		});
	}

	async clearCartId(): Promise<void> {
		await this.storage.remove(this.cartKey);
	}

	/** The remembered numeric shop id, or null. Also primes {@link peekStoreId}. */
	async getStoreId(): Promise<string | null> {
		const stored = normalize(await this.storage.get(this.storeKey));
		if (stored !== null) this.lastStoreId = stored;
		return stored;
	}

	/**
	 * The remembered store id without waiting on storage, for the synchronous
	 * `hostedUrl()`. Reads memory, then storage if the adapter answers
	 * synchronously; with an async-only adapter it is null until a cart has
	 * been read.
	 */
	peekStoreId(): string | null {
		if (this.lastStoreId === null) {
			this.lastStoreId = this.peekKey(this.storeKey);
		}
		return this.lastStoreId;
	}

	/**
	 * Remember the shop's numeric id, noted off every cart. Storage writes are
	 * best-effort and only happen when the value changes; the in-memory copy
	 * is always kept.
	 */
	async setStoreId(storeId: string | number): Promise<void> {
		const next = String(storeId).trim();
		if (!next || this.lastStoreId === next) return;
		this.lastStoreId = next;
		await this.persistIfChanged(this.storeKey, next, this.ttlSeconds);
	}

	/** Forget the cart's copy of the store id; the checkout's copy stays. */
	async clearStoreId(): Promise<void> {
		this.lastStoreId = null;
		await this.storage.remove(this.storeKey);
	}

	async getCheckoutSessionId(): Promise<string | null> {
		return normalize(await this.storage.get(this.sessionKey));
	}

	/**
	 * Remember the checkout handoff id for a day. On the legacy checkout this
	 * is an order uuid rather than a session id (see
	 * `StartCheckoutResult.handoffId`); `checkout.confirmation()` takes either.
	 *
	 * `storeId` is stored alongside, best-effort like {@link setStoreId}; only
	 * the session id write may throw.
	 */
	async setCheckoutSessionId(
		sessionId: string,
		storeId?: string | number | null,
	): Promise<void> {
		await this.storage.set(this.sessionKey, sessionId, {
			ttlSeconds: CHECKOUT_SESSION_TTL_SECONDS,
		});
		const next = storeId == null ? "" : String(storeId).trim();
		if (!next) return;
		this.lastCheckoutStoreId = next;
		await this.persistIfChanged(
			this.checkoutStoreKey,
			next,
			CHECKOUT_SESSION_TTL_SECONDS,
		);
	}

	/** The checkout session's store id; same rules as {@link peekStoreId}. */
	peekCheckoutStoreId(): string | null {
		if (this.lastCheckoutStoreId === null) {
			this.lastCheckoutStoreId = this.peekKey(this.checkoutStoreKey);
		}
		return this.lastCheckoutStoreId;
	}

	/** Forget the checkout session, and the store id remembered with it. */
	async clearCheckoutSessionId(): Promise<void> {
		this.lastCheckoutStoreId = null;
		await this.storage.remove(this.sessionKey);
		await this.storage.remove(this.checkoutStoreKey);
	}

	/** The logged-in customer's session, serialized by `CustomerAuth`. A credential. */
	async getCustomerSession(): Promise<string | null> {
		return normalize(await this.storage.get(this.customerKey));
	}

	/**
	 * The customer session without waiting on storage; see {@link peekStoreId}.
	 * `undefined` when the adapter cannot answer synchronously, so "nobody is
	 * logged in" (null) and "not known yet" stay apart.
	 */
	peekCustomerSession(): string | null | undefined {
		let raw: MaybePromise<string | null>;
		try {
			raw = this.storage.get(this.customerKey);
		} catch {
			return undefined;
		}
		if (isPromiseLike(raw)) {
			void Promise.resolve(raw).catch(() => undefined);
			return undefined;
		}
		return normalize(raw);
	}

	/** The storage key of the customer session, for `storage` events. */
	get customerSessionKey(): string {
		return this.customerKey;
	}

	async setCustomerSession(value: string, ttlSeconds: number): Promise<void> {
		await this.storage.set(this.customerKey, value, { ttlSeconds });
	}

	async clearCustomerSession(): Promise<void> {
		await this.storage.remove(this.customerKey);
	}

	/** Forget everything: the cart, the session and both copies of the store id. */
	async clear(): Promise<void> {
		await this.clearCartId();
		await this.clearStoreId();
		await this.clearCheckoutSessionId();
	}

	/**
	 * Read one key synchronously, or null when the adapter cannot. Never throws,
	 * and swallows a rejected promise so it is not unhandled.
	 */
	private peekKey(key: string): string | null {
		let raw: MaybePromise<string | null>;
		try {
			raw = this.storage.get(key);
		} catch {
			return null;
		}
		if (isPromiseLike(raw)) {
			void Promise.resolve(raw).catch(() => undefined);
			return null;
		}
		return normalize(raw);
	}

	/** Write a value only when storage does not already hold it; never throws. */
	private async persistIfChanged(
		key: string,
		value: string,
		ttlSeconds: number,
	): Promise<void> {
		try {
			if (normalize(await this.storage.get(key)) === value) return;
			await this.storage.set(key, value, { ttlSeconds });
		} catch {
			// Best-effort: the value is already in memory.
		}
	}
}

const CHECKOUT_SESSION_TTL_SECONDS = 60 * 60 * 24;

/** An empty-string cookie is how "deleted" looks; treat it as absent. */
function normalize(value: string | null): string | null {
	if (value === null) return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
	return typeof (value as { then?: unknown } | null)?.then === "function";
}
