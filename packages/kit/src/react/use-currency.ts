"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ShopkitClient } from "../sdk/client.js";
import { type CurrencyInfo, describeCurrency } from "../sdk/currency.js";
import type { CurrencyCode } from "../sdk/types/common.js";
import type { Shop } from "../sdk/types/shop.js";
import { getShopPromise } from "../state/shop-cache.js";
import { useShopkit } from "./context.js";

/**
 * The client's current currency, re-rendering when it changes. The server
 * snapshot is the configured default, so a server render and the first
 * client paint agree even when the browser has a remembered choice — the
 * client then re-renders with it.
 */
export function useClientCurrency(
	client: ShopkitClient | null,
): CurrencyCode | null {
	const subscribe = useCallback(
		(notify: () => void) => client?.onCurrencyChange(notify) ?? (() => {}),
		[client],
	);
	return useSyncExternalStore(
		subscribe,
		() => client?.currency ?? null,
		() => client?.defaultCurrency ?? null,
	);
}

export interface UseCurrencyResult extends CurrencyInfo {
	/**
	 * What was asked for — the shopper's remembered choice, else the
	 * configured default — whether or not the shop offers it. `currency` is
	 * what prices are actually shown in.
	 */
	selected: CurrencyCode | null;
	/**
	 * Browse in another currency. Every catalog hook refetches, `useCart()`
	 * re-reads the same cart in it, and the choice is remembered. `null`
	 * returns to the default.
	 */
	setCurrency: (currency: string | null) => Promise<void>;
	/** True while the shop (and with it the list of currencies) is loading. */
	isLoading: boolean;
	error: Error | null;
}

/**
 * The currency the shop is browsed in, what the shop offers, and a setter —
 * everything a currency switcher needs.
 *
 * ```tsx
 * function CurrencySwitcher() {
 *   const { currency, currencies, setCurrency } = useCurrency()
 *   if (currencies.length < 2) return null
 *   return (
 *     <select value={currency ?? ""} onChange={(e) => setCurrency(e.target.value)}>
 *       {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
 *     </select>
 *   )
 * }
 * ```
 *
 * `mode` says what the choice means: `"display"` is shown converted and
 * charged in the shop's currency at checkout, `"charge"` is priced and
 * charged in it, `"base"` is the shop's own. The shop is read once per client
 * (`shop.get()`, which needs `checkout:read`) and shared by every caller.
 */
export function useCurrency(): UseCurrencyResult {
	const client = useShopkit();
	const selected = useClientCurrency(client);
	const [shop, setShop] = useState<{
		client: ShopkitClient;
		data: Shop;
	} | null>(null);
	const [error, setError] = useState<Error | null>(null);

	useEffect(() => {
		let active = true;
		setError(null);
		getShopPromise(client).then(
			(data) => {
				if (active) setShop({ client, data });
			},
			(cause: unknown) => {
				if (active) {
					setError(cause instanceof Error ? cause : new Error(String(cause)));
				}
			},
		);
		return () => {
			active = false;
		};
	}, [client]);

	const data = shop?.client === client ? shop.data : null;
	const setCurrency = useCallback(
		(currency: string | null) => client.setCurrency(currency),
		[client],
	);

	return {
		...describeCurrency(data, selected),
		selected,
		setCurrency,
		isLoading: data === null && error === null,
		error,
	};
}
