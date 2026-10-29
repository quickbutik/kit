import type { ShopkitClient } from "../sdk/client.js";
import type { Shop } from "../sdk/types/shop.js";

/**
 * One shared `shop.get()` per client. Keyed in a `WeakMap` so a per-request
 * server client is collected with its entry; a rejected read is evicted so
 * the next caller retries.
 */
const shops = new WeakMap<ShopkitClient, Promise<Shop>>();

export function getShopPromise(client: ShopkitClient): Promise<Shop> {
	const existing = shops.get(client);
	if (existing) return existing;
	const promise = client.shop.get();
	promise.catch(() => {
		if (shops.get(client) === promise) shops.delete(client);
	});
	shops.set(client, promise);
	return promise;
}

/** Forget a client's cached shop, so the next read goes to the API. */
export function clearShopCache(client: ShopkitClient): void {
	shops.delete(client);
}
