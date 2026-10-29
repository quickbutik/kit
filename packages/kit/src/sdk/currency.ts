import type { StorageAdapter } from "../runtime/storage.js";
import { ShopkitConfigError } from "./errors.js";
import type { CurrencyCode } from "./types/common.js";
import type { Shop, ShopCurrency, ShopCurrencyMode } from "./types/shop.js";

/**
 * How long a shopper's currency choice is remembered: a year. It is a
 * preference, not a session handle, so it outlives the cart.
 */
const CURRENCY_TTL_SECONDS = 60 * 60 * 24 * 365;

const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

/**
 * `"eur"` / `" EUR "` → `"EUR"`; `null`, `undefined` and `""` → null.
 *
 * Throws a `ShopkitConfigError` for anything that is not three letters, so a
 * typo is reported by name rather than as a 400 from the API.
 */
export function normalizeCurrency(
	value: string | null | undefined,
	context = "currency",
): CurrencyCode | null {
	if (value == null) return null;
	const trimmed = value.trim();
	if (trimmed === "") return null;
	if (!CURRENCY_PATTERN.test(trimmed)) {
		throw new ShopkitConfigError(
			`shopkit: ${context} must be a three-letter ISO 4217 code like "EUR", got ${JSON.stringify(value)}.`,
		);
	}
	return trimmed.toUpperCase();
}

/** {@link normalizeCurrency} that answers null instead of throwing. */
function tryNormalize(value: string | null | undefined): CurrencyCode | null {
	try {
		return normalizeCurrency(value);
	} catch {
		return null;
	}
}

/**
 * The client's currency: what the shopper picked, else what the config said,
 * else nothing (the shop's own currency).
 *
 * The choice is persisted under `${prefix}_currency`, so a server render using
 * request cookies prices the page in the currency the browser picked. A
 * malformed stored value is ignored, so a tampered cookie cannot 400 the
 * catalog.
 */
export class CurrencyPreference {
	private readonly key: string;
	/**
	 * A choice made in this process, which beats storage so it applies even
	 * when the adapter cannot be written (an RSC's read-only cookies).
	 * `{ code: null }` is an explicit reset; `null` means nothing was chosen.
	 */
	private chosen: { code: CurrencyCode | null } | null = null;
	private readonly listeners = new Set<(code: CurrencyCode | null) => void>();

	constructor(
		private readonly storage: StorageAdapter,
		prefix: string,
		/** The configured default, already normalized. */
		readonly fallback: CurrencyCode | null,
	) {
		this.key = `${prefix}_currency`;
	}

	/**
	 * The current code without waiting on storage. An adapter that only
	 * answers with a promise (Next's `cookies()`) is skipped and the configured
	 * default returned; use {@link resolve} there.
	 */
	peek(): CurrencyCode | null {
		if (this.chosen) return this.chosen.code ?? this.fallback;
		let raw: unknown;
		try {
			raw = this.storage.get(this.key);
		} catch {
			raw = null;
		}
		if (raw !== null && typeof raw === "object" && "then" in raw) {
			void Promise.resolve(raw).catch(() => undefined);
			return this.fallback;
		}
		return tryNormalize(raw as string | null) ?? this.fallback;
	}

	/** The current code, consulting async storage too. What requests use. */
	async resolve(): Promise<CurrencyCode | null> {
		if (this.chosen) return this.chosen.code ?? this.fallback;
		try {
			const stored = tryNormalize(await this.storage.get(this.key));
			return stored ?? this.fallback;
		} catch {
			return this.fallback;
		}
	}

	/**
	 * Choose a currency, remember it, and tell every subscriber. `null` forgets
	 * the choice and goes back to the configured default (or the shop's own
	 * currency when none is configured).
	 */
	async set(value: string | null): Promise<void> {
		const code = normalizeCurrency(value, "setCurrency()");
		const before = this.peek();
		this.chosen = { code };
		try {
			if (code === null) await this.storage.remove(this.key);
			else
				await this.storage.set(this.key, code, {
					ttlSeconds: CURRENCY_TTL_SECONDS,
				});
		} catch {
			// Best effort: the choice holds for this process, and a read-only
			// cookie jar must not make a currency switch fail.
		}
		const after = this.peek();
		if (after === before) return;
		for (const listener of [...this.listeners]) listener(after);
	}

	subscribe(listener: (code: CurrencyCode | null) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}

/** What a currency choice means for one shop. See {@link describeCurrency}. */
export interface CurrencyInfo {
	/**
	 * The currency prices are shown in: the chosen code when the shop offers
	 * it, else the shop's own currency. Null only before the shop is known and
	 * with nothing chosen.
	 */
	currency: CurrencyCode | null;
	/** The shop's own (base) currency, or null when the shop is not known yet. */
	baseCurrency: CurrencyCode | null;
	/**
	 * - `"base"` — the shop's own currency; nothing is converted.
	 * - `"display"` — prices are SHOWN converted, and the checkout charges the
	 *   shop's currency (with the converted amount as an approximation).
	 * - `"charge"` — priced and charged in `currency`.
	 */
	mode: ShopCurrencyMode;
	/** Units of `currency` per 1 unit of the base currency. 1 for `"base"`. */
	rate: number;
	/** What the checkout will charge: the base currency, or `currency` in charge mode. */
	chargeCurrency: CurrencyCode | null;
	/** Every currency the shop offers, base first. Empty until the shop is known. */
	currencies: ShopCurrency[];
}

/**
 * Resolve a currency choice against what the shop offers, as the platform
 * does: a code the shop does not offer falls back to the shop's currency.
 *
 * ```ts
 * const shop = await shopkit.shop.get()
 * describeCurrency(shop, shopkit.currency)
 * // { currency: "EUR", baseCurrency: "SEK", mode: "charge", rate: 0.0871, … }
 * ```
 */
export function describeCurrency(
	shop: Pick<Shop, "currency" | "currencies"> | null | undefined,
	selected: string | null | undefined,
): CurrencyInfo {
	const code = tryNormalize(selected);
	const currencies = shop?.currencies ?? [];
	const baseCurrency =
		tryNormalize(shop?.currency) ??
		currencies.find((entry) => entry.mode === "base")?.code ??
		null;
	if (!shop) {
		return {
			currency: code,
			baseCurrency: null,
			mode: "base",
			rate: 1,
			chargeCurrency: null,
			currencies,
		};
	}
	const offered =
		code === null
			? undefined
			: currencies.find((entry) => entry.code.toUpperCase() === code);
	if (!offered || offered.mode === "base") {
		return {
			currency: baseCurrency,
			baseCurrency,
			mode: "base",
			rate: 1,
			chargeCurrency: baseCurrency,
			currencies,
		};
	}
	const currency = offered.code.toUpperCase();
	return {
		currency,
		baseCurrency,
		mode: offered.mode,
		rate: offered.rate,
		chargeCurrency: offered.mode === "charge" ? currency : baseCurrency,
		currencies,
	};
}
