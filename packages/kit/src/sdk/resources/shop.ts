import type { ScopeGuard } from "../scopes.js";
import type { Transport } from "../transport.js";
import type { RequestOptions } from "../types/common.js";
import type { Shop } from "../types/shop.js";

/**
 * Shop-level presentation data: name, logo, brand colour, default language,
 * terms link. Everything a storefront shell needs before it renders.
 */
export class ShopResource {
	constructor(
		private readonly transport: Transport,
		private readonly scopes: ScopeGuard,
	) {}

	/**
	 * Served by the checkout's shop endpoint — the only shop surface a
	 * publishable key can reach, hence the `checkout:read` scope for what looks
	 * like plain branding.
	 */
	async get(options: RequestOptions = {}): Promise<Shop> {
		this.scopes.assert("checkout:read", "shop.get()");
		return this.transport.request<Shop>({
			method: "GET",
			path: "/checkout/shop",
			signal: options.signal,
			errorMessage: "shopkit: could not load shop",
		});
	}
}
