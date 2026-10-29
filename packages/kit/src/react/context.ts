"use client";

import { createContext, useContext } from "react";
import type { ShopkitClient } from "../sdk/client.js";
import { ShopkitConfigError } from "../sdk/errors.js";
import type { CartStore } from "../state/cart-store.js";

export interface ShopkitContextValue {
	client: ShopkitClient;
	cartStore: CartStore;
}

export const ShopkitContext = createContext<ShopkitContextValue | null>(null);

/**
 * The configured client. Throws if there is no `<ShopkitProvider>` above the
 * calling component.
 */
export function useShopkit(): ShopkitClient {
	return useShopkitContext().client;
}

export function useShopkitContext(): ShopkitContextValue {
	const value = useContext(ShopkitContext);
	if (!value) {
		throw new ShopkitConfigError(
			"shopkit: no <ShopkitProvider> above this component. Wrap your app " +
				"(or the client subtree that needs it) in one.",
		);
	}
	return value;
}
