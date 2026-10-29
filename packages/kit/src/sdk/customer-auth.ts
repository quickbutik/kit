import { isBrowser } from "../runtime/detect.js";
import type { SessionStore } from "../state/session-store.js";
import { ShopkitApiError } from "./errors.js";
import type { CustomerTokenSource, Transport } from "./transport.js";
import type {
	Customer,
	CustomerSession,
	CustomerSessionInput,
	CustomerState,
} from "./types/customer.js";

/**
 * The DOM event dispatched on `document` after every login, logout and
 * expiry. Its `detail` is `{ customerId }`, or null when nobody is logged in;
 * never the profile, which other scripts on the page have no need to read.
 */
export const CUSTOMER_EVENT = "qb:customer";

/** Renew the access token this long before it expires. */
const RENEW_BEFORE_MS = 30_000;

/** How long a stored session lives when the platform gave no refresh expiry. */
const FALLBACK_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Refusals of a refresh that mean the session is over, not "try later". */
const SESSION_OVER = [
	"customer_token_invalid",
	"customer_token_shop_mismatch",
	"customer_blocked",
	"customer_login_disabled",
];

/**
 * A session as kept in storage. Expiries are epoch milliseconds on THIS
 * machine's clock (see `toStored`); NaN = unknown.
 */
export interface StoredSession {
	accessToken: string;
	accessExpiresAt: number;
	refreshToken: string | null;
	refreshExpiresAt: number;
	/** The customer id (`sub`) from the access token. */
	customerId: string | null;
}

export interface CustomerAuthOptions {
	/** The storage prefix, naming the cross-tab renewal lock. */
	prefix: string;
	/**
	 * Whether this client may renew the session. False for storage that
	 * cannot be written (an RSC's cookies), where a rotated refresh token
	 * would be lost; the access token's expiry then means "logged out".
	 */
	renew: boolean;
}

/**
 * The logged-in customer's session for ONE client: the tokens, their renewal,
 * and the change notifications.
 *
 * Per client on purpose: a server builds one client per request, and a
 * session held anywhere longer-lived would be served to the next shopper.
 * Clients and tabs sharing one storage stay in step because storage is
 * re-read before every renewal.
 */
export class CustomerAuth implements CustomerTokenSource {
	/** `undefined` until read from storage; null = nobody logged in. */
	private session: StoredSession | null | undefined;
	private loading: Promise<void> | null = null;
	private renewing: Promise<StoredSession | null> | null = null;
	/** Every storage write, in order; readers that compare against storage wait on it. */
	private writes: Promise<void> = Promise.resolve();
	/** The session this client last wrote to storage successfully. */
	private saved: StoredSession | null = null;
	private dropping = false;
	private readonly listeners = new Set<(state: CustomerState | null) => void>();
	private unwatch: (() => void) | null = null;
	/** The profile last returned by login / refresh / me, for this session. */
	customer: Customer | null = null;
	/** Bumped on every change of who is logged in; part of cache keys. */
	revision = 0;

	constructor(
		private readonly store: SessionStore,
		private readonly transport: Transport,
		private readonly options: CustomerAuthOptions,
	) {}

	/** Whether the session has been read from storage (or set) yet. */
	get loaded(): boolean {
		return this.session !== undefined;
	}

	/** The session without waiting on storage (sync adapters only). */
	peek(): StoredSession | null {
		if (this.session === undefined) {
			const raw = this.store.peekCustomerSession();
			if (raw !== undefined) {
				const parsed = raw ? parseSession(raw) : null;
				this.session = parsed;
				this.saved = parsed;
			}
		}
		return this.live();
	}

	/** The session, read from storage once. */
	async load(): Promise<StoredSession | null> {
		if (this.session === undefined) {
			this.loading ??= this.readStored()
				.then((stored) => {
					// A login while the read was out wins over what storage held.
					if (this.session === undefined) {
						this.session = stored ?? null;
						this.saved = this.session;
					}
				})
				.finally(() => {
					this.loading = null;
				});
			await this.loading;
		}
		return this.live();
	}

	async token(): Promise<string | null> {
		const session = await this.load();
		if (!session) return null;
		if (isFresh(session)) return session.accessToken;
		if (!this.options.renew) {
			return session.accessExpiresAt > Date.now() ? session.accessToken : null;
		}
		return (await this.refresh(session.accessToken))?.accessToken ?? null;
	}

	async renew(token: string): Promise<string | null> {
		if (!this.options.renew) return null;
		return (await this.refresh(token))?.accessToken ?? null;
	}

	async reject(token: string): Promise<void> {
		// Only the session that sent the token: a login that landed while this
		// request was out must not be thrown away for the old token's sake.
		if (this.session?.accessToken !== token) return;
		await this.drop();
	}

	/**
	 * Swap the refresh token for a new pair. One renewal at a time per client,
	 * and (with Web Locks) per storage prefix across tabs; a caller whose stale
	 * token was already replaced gets the replacement without a round trip.
	 *
	 * A refusal that ends the session (`customer_token_invalid`,
	 * `customer_blocked`, …) drops it and resolves null; anything else keeps
	 * the session and throws, so a network blip does not log the shopper out.
	 */
	refresh(stale?: string): Promise<StoredSession | null> {
		this.renewing ??= this.locked(() => this.renewNow(stale)).finally(() => {
			this.renewing = null;
		});
		return this.renewing;
	}

	private locked<T>(run: () => Promise<T>): Promise<T> {
		const locks = isBrowser()
			? (navigator as { locks?: WebLocks }).locks
			: undefined;
		return locks
			? (locks.request(
					`qb-customer-refresh:${this.options.prefix}`,
					run,
				) as Promise<T>)
			: run();
	}

	private async renewNow(stale?: string): Promise<StoredSession | null> {
		await this.load();
		await this.syncFromStorage(false);
		const current = this.live();
		if (!current) return null;
		if (current.accessToken !== stale && isFresh(current)) return current;
		if (!current.refreshToken) {
			await this.drop();
			return null;
		}
		let response: CustomerSession;
		try {
			response = await this.transport.request<CustomerSession>({
				method: "POST",
				path: "/account/refresh",
				body: { refreshToken: current.refreshToken },
				customer: false,
				errorMessage: "shopkit: could not renew the customer session",
			});
		} catch (error) {
			if (
				error instanceof ShopkitApiError &&
				SESSION_OVER.includes(error.code ?? "")
			) {
				if (this.session === current) await this.drop();
				return this.live();
			}
			throw error;
		}
		// Logged out, or in as someone else, while the renewal was out.
		if (this.session !== current) return this.live();
		const next = toStored(response);
		this.session = next;
		await this.write(() => this.save(next));
		if (response.customer) this.setProfile(response.customer);
		return next;
	}

	/**
	 * Start a session: store it, and tell every listener. Switching to a
	 * different customer (even from an expired session) also clears the cart,
	 * which is bound to the previous customer.
	 */
	begin(input: CustomerSessionInput, customer: Customer | null): Promise<void> {
		// Synchronous up to the first await, so a request made right after an
		// un-awaited `setSession()` already carries the new token.
		const before = this.session;
		const next = toStored(input);
		this.session = next;
		this.customer = customer;
		return this.write(async () => {
			const stored = await this.readStored();
			const switched = [before, stored].some(
				(previous) => previous && previous.customerId !== next.customerId,
			);
			if (switched) await this.store.clearCartId().catch(() => undefined);
			// Logged out again before the write; that is the newer truth.
			if (this.session !== next) return;
			await this.save(next);
		}).then(() => {
			if (this.session === next) this.emit(true);
		});
	}

	/**
	 * End the session involuntarily: the platform refused it, or it expired.
	 * The customer's cart would refuse a guest, so it is cleared too, before
	 * the change is announced.
	 */
	async drop(): Promise<void> {
		this.session = null;
		await this.store.clearCartId().catch(() => undefined);
		await this.end();
	}

	/** Forget the session locally and tell every listener. */
	async end(): Promise<void> {
		this.session = null;
		this.customer = null;
		await this.write(async () => {
			this.saved = null;
			try {
				await this.store.clearCustomerSession();
			} catch {
				// A read-only cookie jar (an RSC) cannot forget it; this client has.
			}
		});
		this.emit(true);
	}

	/** A new profile for the same session: listeners hear it, caches do not move. */
	setProfile(customer: Customer): void {
		if (!this.session || this.customer === customer) return;
		this.customer = customer;
		this.emit(false);
	}

	subscribe(listener: (state: CustomerState | null) => void): () => void {
		this.listeners.add(listener);
		if (!this.unwatch) this.unwatch = this.watchOtherTabs();
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) {
				this.unwatch?.();
				this.unwatch = null;
			}
		};
	}

	state(): CustomerState | null {
		const session = this.live();
		return session
			? { customerId: session.customerId, customer: this.customer }
			: null;
	}

	/**
	 * Notice another tab logging in or out: `localStorage` fires a `storage`
	 * event, while cookies are re-read when the tab becomes visible. Only while
	 * someone listens, so the window does not keep a dropped client alive.
	 */
	private watchOtherTabs(): (() => void) | null {
		if (!isBrowser()) return null;
		const key = this.store.customerSessionKey;
		const onStorage = (event: StorageEvent) => {
			if (event.key === key || event.key === null) {
				void this.syncFromStorage(true);
			}
		};
		const onVisible = () => {
			if (document.visibilityState === "visible") {
				void this.syncFromStorage(true);
			}
		};
		window.addEventListener("storage", onStorage);
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			window.removeEventListener("storage", onStorage);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}

	/**
	 * Adopt what storage holds when another writer has changed it: a rotated
	 * pair (silently), another customer, or a logout. Only `fromOtherTab`
	 * adopts a login while this client has nobody, so a client that just
	 * logged out is not logged back in by its own not-yet-cleared storage.
	 */
	private async syncFromStorage(fromOtherTab: boolean): Promise<void> {
		await this.writes;
		const stored = await this.readStored();
		if (stored === undefined) return;
		const memory = this.session;
		if (memory === undefined) return;
		if (stored === null) {
			// Only a session this client managed to write can have been removed
			// by someone else; one it never could write is not "gone".
			if (memory && memory === this.saved) {
				this.session = null;
				this.customer = null;
				this.saved = null;
				this.emit(true);
			}
			return;
		}
		if (!memory && !fromOtherTab) return;
		if (
			memory &&
			memory.accessToken === stored.accessToken &&
			memory.refreshToken === stored.refreshToken
		) {
			return;
		}
		const switched = memory?.customerId !== stored.customerId || !memory;
		this.session = stored;
		this.saved = stored;
		if (switched) {
			this.customer = null;
			if (this.live()) this.emit(true);
		}
	}

	/**
	 * The session if it can still produce a valid token; otherwise it is
	 * dropped (storage cleared, cart forgotten, listeners told) in a microtask,
	 * so a read during a render never notifies anyone synchronously.
	 */
	private live(): StoredSession | null {
		const session = this.session;
		if (!session) return null;
		if (usable(session, this.options.renew)) return session;
		this.session = null;
		this.customer = null;
		if (!this.dropping) {
			this.dropping = true;
			queueMicrotask(() => {
				void this.store
					.clearCartId()
					.catch(() => undefined)
					// A login that landed meanwhile is not this expiry's to end.
					.then(() => (this.session === null ? this.end() : undefined))
					.finally(() => {
						this.dropping = false;
					});
			});
		}
		return null;
	}

	/** Storage's session, bypassing memory; `undefined` when it cannot be read. */
	private async readStored(): Promise<StoredSession | null | undefined> {
		try {
			const raw = await this.store.getCustomerSession();
			return raw === null ? null : parseSession(raw);
		} catch {
			return undefined;
		}
	}

	/** Write through to storage. Best effort: the session holds in memory. */
	private async save(next: StoredSession): Promise<void> {
		const ttl = Number.isFinite(next.refreshExpiresAt)
			? Math.max(1, Math.floor((next.refreshExpiresAt - Date.now()) / 1000))
			: FALLBACK_TTL_SECONDS;
		try {
			await this.store.setCustomerSession(serialize(next), ttl);
			this.saved = next;
		} catch {
			// Same reasoning as `end()`.
		}
	}

	/** Run a storage write after every earlier one. */
	private write(run: () => Promise<void>): Promise<void> {
		const done = this.writes.then(run);
		this.writes = done.catch(() => undefined);
		return done;
	}

	/**
	 * Tell every listener. `identity` is a change of who is logged in: it
	 * moves `revision` (and with it every cache key) and is announced on
	 * `document`. A new profile for the same customer is neither.
	 */
	private emit(identity: boolean): void {
		if (identity) this.revision += 1;
		const state = this.state();
		for (const listener of [...this.listeners]) listener(state);
		if (identity && isBrowser() && typeof CustomEvent === "function") {
			document.dispatchEvent(
				new CustomEvent<{ customerId: string | null } | null>(CUSTOMER_EVENT, {
					detail: state ? { customerId: state.customerId } : null,
				}),
			);
		}
	}
}

/** The slice of the Web Locks API used here (absent from some runtimes' types). */
interface WebLocks {
	request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
}

/** Good for longer than the renewal margin, or of unknown expiry. */
function isFresh(session: StoredSession): boolean {
	// Written this way so an unknown (NaN) expiry counts as fresh: the
	// platform says `customer_token_expired` if it is not.
	return !(session.accessExpiresAt - Date.now() <= RENEW_BEFORE_MS);
}

/** Whether a session can still produce a valid token. */
function usable(session: StoredSession, renew: boolean): boolean {
	const now = Date.now();
	if (!(session.accessExpiresAt <= now)) return true;
	return (
		renew && session.refreshToken !== null && !(session.refreshExpiresAt <= now)
	);
}

/**
 * A session as the platform (or `setSession()`) hands it over, with its
 * expiries moved onto this machine's clock: the access token lives `exp - iat`
 * seconds from when it was received, and the refresh expiry shifts by the
 * same offset. Otherwise a device with a skewed clock would renew on every
 * request, or never.
 */
export function toStored(input: CustomerSessionInput): StoredSession {
	const receivedAt = Date.now();
	const claims = decodeJwtPayload(input.accessToken);
	const exp = finiteNumber(claims?.exp);
	const iat = finiteNumber(claims?.iat);
	const serverAccess =
		parseTime(input.accessTokenExpiresAt) ?? (exp === null ? null : exp * 1000);
	const localAccess =
		exp !== null && iat !== null && exp > iat
			? receivedAt + (exp - iat) * 1000
			: (serverAccess ?? Number.NaN);
	const offset = serverAccess === null ? 0 : localAccess - serverAccess;
	const serverRefresh = parseTime(input.refreshTokenExpiresAt);
	return {
		accessToken: input.accessToken,
		accessExpiresAt: localAccess,
		refreshToken: input.refreshToken || null,
		refreshExpiresAt:
			serverRefresh === null ? Number.NaN : serverRefresh + offset,
		customerId: customerIdOf(claims),
	};
}

/** The customer id (`sub`) of decoded access-token claims. */
function customerIdOf(claims: Record<string, unknown> | null): string | null {
	const sub = claims?.sub;
	return (typeof sub === "string" && sub) || typeof sub === "number"
		? String(sub)
		: null;
}

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseTime(value: string | null | undefined): number | null {
	if (!value) return null;
	const time = Date.parse(value);
	return Number.isNaN(time) ? null : time;
}

function serialize(session: StoredSession): string {
	return JSON.stringify({
		a: session.accessToken,
		ae: session.accessExpiresAt,
		r: session.refreshToken,
		re: session.refreshExpiresAt,
	});
}

/** A stored value, or null for anything that is not one (a tampered cookie). */
function parseSession(raw: string): StoredSession | null {
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		if (typeof value.a !== "string" || !value.a) return null;
		return {
			accessToken: value.a,
			accessExpiresAt: finiteNumber(value.ae) ?? Number.NaN,
			refreshToken: typeof value.r === "string" && value.r ? value.r : null,
			refreshExpiresAt: finiteNumber(value.re) ?? Number.NaN,
			customerId: customerIdOf(decodeJwtPayload(value.a)),
		};
	} catch {
		return null;
	}
}

/**
 * The claims of a JWT, decoded WITHOUT verifying the signature. Used only to
 * read `sub`, `exp` and `iat` for keying and scheduling; the API verifies.
 * Null for anything that is not a JSON object payload.
 */
export function decodeJwtPayload(
	token: string,
): Record<string, unknown> | null {
	const part = token.split(".")[1];
	if (!part || typeof atob !== "function") return null;
	try {
		const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
		const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}
