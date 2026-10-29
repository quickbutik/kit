"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AddCartItemInput, Cart } from "../sdk/types/cart.js";
import type { CartSnapshot } from "../state/cart-store.js";
import { useShopkitContext } from "./context.js";

export interface UseCartResult extends CartSnapshot {
	/** Add a product; creates the cart on first use. */
	add: (item: AddCartItemInput) => Promise<Cart | null>;
	/** Set an absolute quantity on a cart LINE id. 0 removes the line. */
	updateItem: (itemId: string, quantity: number) => Promise<Cart | null>;
	removeItem: (itemId: string) => Promise<Cart | null>;
	/**
	 * Empty the basket: delete the remembered cart server-side and forget it,
	 * so the next `add` starts a fresh one. A cart the server already dropped
	 * counts as cleared; with no cart at all it does nothing.
	 */
	clear: () => Promise<void>;
	/** Alias of {@link clear}. */
	clearCart: () => Promise<void>;
	/** Re-read from the server. */
	refresh: () => Promise<Cart | null>;
}

/**
 * The shopper's cart, shared across every component that calls this.
 *
 * ```tsx
 * const { cart, itemCount, add, pending } = useCart()
 * <button onClick={() => add({ productId })} disabled={pending > 0}>Add</button>
 * ```
 *
 * The cart is loaded on first mount and never created speculatively — a visitor
 * who only browses causes no writes.
 */
export function useCart(): UseCartResult {
	const { cartStore } = useShopkitContext();

	const snapshot = useSyncExternalStore(
		cartStore.subscribe,
		cartStore.getSnapshot,
		// Server render: the snapshot from `initialCart`, so SSR and the first
		// client paint agree.
		cartStore.getSnapshot,
	);

	useEffect(() => {
		void cartStore.load();
	}, [cartStore]);

	const add = useCallback(
		(item: AddCartItemInput) => cartStore.add(item),
		[cartStore],
	);
	const updateItem = useCallback(
		(itemId: string, quantity: number) =>
			cartStore.updateItem(itemId, quantity),
		[cartStore],
	);
	const removeItem = useCallback(
		(itemId: string) => cartStore.removeItem(itemId),
		[cartStore],
	);
	const clear = useCallback(() => cartStore.clear(), [cartStore]);
	const refresh = useCallback(() => cartStore.refresh(), [cartStore]);

	return {
		...snapshot,
		add,
		updateItem,
		removeItem,
		clear,
		clearCart: clear,
		refresh,
	};
}
