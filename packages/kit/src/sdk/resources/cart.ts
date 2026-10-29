import type { SessionStore } from "../../state/session-store.js";
import type { CurrencyPreference } from "../currency.js";
import { isUnusableCartError, ShopkitApiError } from "../errors.js";
import type { ScopeGuard } from "../scopes.js";
import {
	assertRememberingCallBinding,
	resolveStorefrontAttribution,
	type StorefrontAttribution,
	type StorefrontBinding,
} from "../storefront.js";
import type { Transport } from "../transport.js";
import type { AddCartItemInput, Cart } from "../types/cart.js";
import type { RequestOptions } from "../types/common.js";

/**
 * Options for the calls that may CREATE a cart: the request signal, plus the
 * campaign storefront to bind the new cart to. On `create()` any campaign may
 * be named; on `ensure()` / `add()`, which reuse the remembered cart, a
 * `storefrontId` must match the client's binding — see `StorefrontAttribution`.
 */
export type CartCreateOptions = RequestOptions & StorefrontAttribution;

/**
 * The shopper's cart.
 *
 * The plain methods (`create`, `get`, `addItem`, …) are a thin, stateless
 * mapping of the Cart API. `current`, `ensure`, `add` and `clear` also
 * remember which cart this visitor has, the same way in the browser, a server
 * component and a server action.
 */
export class CartResource {
	constructor(
		private readonly transport: Transport,
		private readonly scopes: ScopeGuard,
		private readonly store: SessionStore,
		private readonly storefront: StorefrontBinding | null = null,
		private readonly currency: CurrencyPreference | null = null,
	) {}

	/**
	 * `?currency=` for every request that answers with a priced cart. The cart
	 * stores no currency; it is priced per request.
	 */
	private async currencyQuery(): Promise<{ currency: string | undefined }> {
		return { currency: (await this.currency?.resolve()) ?? undefined };
	}

	// Stateless Cart API

	/**
	 * Create a new empty cart. Does not remember it — see {@link ensure}.
	 *
	 * On a client bound to a campaign storefront (or when `storefrontId` is
	 * passed here) the cart is bound to that campaign: the platform prices it
	 * with the campaign's overrides on every read, and a checkout session
	 * created from it inherits the binding. Any campaign may be named here;
	 * pass the returned `cart.id` as `cartId` to `checkout.start()`.
	 */
	async create(options: CartCreateOptions = {}): Promise<Cart> {
		this.scopes.assert("cart:write", "cart.create()");
		const attribution = resolveStorefrontAttribution(options, this.storefront);
		const cart = await this.transport.request<Cart>({
			method: "POST",
			path: "/cart",
			query: await this.currencyQuery(),
			...(attribution && { body: attribution }),
			signal: options.signal,
			errorMessage: "shopkit: could not create cart",
		});
		return this.noteStoreId(cart);
	}

	/** Fetch a cart by id, or null when it no longer exists. */
	async get(
		cartId: string,
		options: RequestOptions = {},
	): Promise<Cart | null> {
		this.scopes.assert("cart:read", "cart.get()");
		const cart = await this.transport.requestOrNull<Cart>({
			method: "GET",
			path: `/cart/${encodeURIComponent(cartId)}`,
			query: await this.currencyQuery(),
			signal: options.signal,
			errorMessage: "shopkit: could not load cart",
		});
		return cart ? this.noteStoreId(cart) : null;
	}

	/**
	 * Add a product. Adding the same product+variant (with the same
	 * `properties`) again increments the existing line rather than creating a
	 * second one, so callers do not have to look first. Different
	 * `properties` make a separate line.
	 */
	async addItem(
		cartId: string,
		item: AddCartItemInput,
		options: RequestOptions = {},
	): Promise<Cart> {
		this.scopes.assert("cart:write", "cart.addItem()");
		const cart = await this.transport.request<Cart>({
			method: "POST",
			path: `/cart/${encodeURIComponent(cartId)}/items`,
			query: await this.currencyQuery(),
			body: {
				productId: item.productId,
				variantId: item.variantId,
				quantity: item.quantity ?? 1,
				...(item.properties &&
					item.properties.length > 0 && {
						properties: item.properties.map(({ propertyId, value }) => ({
							propertyId,
							value,
						})),
					}),
			},
			signal: options.signal,
			errorMessage: "shopkit: could not add item to cart",
		});
		return this.noteStoreId(cart);
	}

	/** Set an absolute quantity on a cart LINE (`item.id`, not the product id). */
	async updateItem(
		cartId: string,
		itemId: string,
		quantity: number,
		options: RequestOptions = {},
	): Promise<Cart> {
		this.scopes.assert("cart:write", "cart.updateItem()");
		const cart = await this.transport.request<Cart>({
			method: "PATCH",
			path: `/cart/${encodeURIComponent(cartId)}/items/${encodeURIComponent(itemId)}`,
			query: await this.currencyQuery(),
			body: { quantity },
			signal: options.signal,
			errorMessage: "shopkit: could not update cart item",
		});
		return this.noteStoreId(cart);
	}

	async removeItem(
		cartId: string,
		itemId: string,
		options: RequestOptions = {},
	): Promise<Cart> {
		this.scopes.assert("cart:write", "cart.removeItem()");
		const cart = await this.transport.request<Cart>({
			method: "DELETE",
			path: `/cart/${encodeURIComponent(cartId)}/items/${encodeURIComponent(itemId)}`,
			query: await this.currencyQuery(),
			signal: options.signal,
			errorMessage: "shopkit: could not remove cart item",
		});
		return this.noteStoreId(cart);
	}

	/** Delete the cart server-side. Also forgets it locally. */
	async delete(cartId: string, options: RequestOptions = {}): Promise<void> {
		this.scopes.assert("cart:write", "cart.delete()");
		await this.transport.requestVoid({
			method: "DELETE",
			path: `/cart/${encodeURIComponent(cartId)}`,
			signal: options.signal,
			errorMessage: "shopkit: could not delete cart",
		});
		if ((await this.store.getCartId()) === cartId) {
			await this.forget();
		}
	}

	// The remembered cart

	/** The remembered cart id, or null when this visitor has none yet. */
	async currentId(): Promise<string | null> {
		return this.store.getCartId();
	}

	/**
	 * The remembered cart, WITHOUT creating one.
	 *
	 * Use this wherever a missing cart is a legitimate answer — a header badge, a
	 * server-rendered cart page — so a crawler or a first-time visitor does not
	 * cause a write. A remembered id that no longer resolves is forgotten and
	 * reported as null.
	 */
	async current(options: RequestOptions = {}): Promise<Cart | null> {
		const cartId = await this.store.getCartId();
		if (!cartId) return null;
		let cart: Cart | null;
		try {
			cart = await this.get(cartId, options);
		} catch (error) {
			// A cart bound to a customer who is not the one asking can never be
			// read by this shopper: as good as gone.
			if (!isUnusableCartError(error)) throw error;
			cart = null;
		}
		if (!cart) await this.forget();
		return cart;
	}

	/**
	 * The remembered cart, creating and remembering one if needed.
	 *
	 * This is the call that needs writable storage. In a read-only context (an
	 * RSC, which cannot set cookies) the cart is still created server-side and
	 * returned — it just is not remembered, so prefer calling it from a place
	 * that CAN write (a server action, a route handler, the browser).
	 *
	 * A cart it creates is bound to the client's campaign storefront (see
	 * {@link create}); a cart it finds is returned as it is. A per-call
	 * `storefrontId` may only restate the client's binding, since the
	 * remembered cart is reused (see `StorefrontAttribution`).
	 */
	async ensure(options: CartCreateOptions = {}): Promise<Cart> {
		assertRememberingCallBinding(options, this.storefront, "cart.ensure()");
		const existing = await this.current(options);
		if (existing) return existing;
		const created = await this.create(options);
		await this.store.setCartId(created.id);
		return created;
	}

	/**
	 * Empty the basket: delete the REMEMBERED cart server-side and forget it
	 * locally, so the next `add()` starts a fresh one.
	 *
	 * ```ts
	 * await shopkit.cart.clear()
	 * ```
	 *
	 * Unlike {@link delete}, needs no cart id:
	 *
	 * - **No remembered cart**: no request is made.
	 * - **The cart is already gone** (404/410: expired, or bought in another
	 *   tab): the stale id is forgotten and nothing throws.
	 * - **Any other failure** (a network error, a 5xx) throws and the id is
	 *   kept, since the cart may still exist server-side.
	 *
	 * A remembered checkout session id is left alone, for the thank-you page.
	 *
	 * `fallbackCartId` is the cart to delete when none is remembered (a cart
	 * rendered from a server read that this browser's storage does not hold).
	 */
	async clear(
		options: RequestOptions & { fallbackCartId?: string | null } = {},
	): Promise<void> {
		const cartId =
			(await this.store.getCartId()) ?? options.fallbackCartId ?? null;
		if (!cartId) return;
		this.scopes.assert("cart:write", "cart.clear()");
		// A 404/410 resolves to null: the "already gone" case above.
		await this.transport.requestOrNull<unknown>({
			method: "DELETE",
			path: `/cart/${encodeURIComponent(cartId)}`,
			signal: options.signal,
			errorMessage: "shopkit: could not clear cart",
		});
		// Only the id this call deleted; another tab may have remembered a newer
		// cart meanwhile.
		if ((await this.store.getCartId()) === cartId) {
			await this.forget();
		}
	}

	/**
	 * Add to the remembered cart, creating it on first use.
	 *
	 * Recovers once from a cart the server has since dropped: a stale id in a
	 * month-old cookie would otherwise 404 the very first "add to cart" click of
	 * a returning visitor.
	 */
	async add(
		item: AddCartItemInput,
		options: CartCreateOptions = {},
	): Promise<Cart> {
		// Checked here too, so the error names add() rather than ensure().
		assertRememberingCallBinding(options, this.storefront, "cart.add()");
		const cart = await this.ensure(options);
		try {
			return await this.addItem(cart.id, item, options);
		} catch (error) {
			if (
				isUnusableCartError(error) ||
				(error instanceof ShopkitApiError &&
					(error.status === 404 || error.status === 410))
			) {
				await this.forget();
				const fresh = await this.ensure(options);
				return await this.addItem(fresh.id, item, options);
			}
			throw error;
		}
	}

	// The remembered store id

	/**
	 * Carts are the only storefront API response that names the shop's
	 * numeric id, which the hosted checkout URL needs. Remember it so
	 * `checkout.hostedUrl()` can be called later without a cart in hand.
	 */
	private async noteStoreId(cart: Cart): Promise<Cart> {
		if (cart.storeId != null) await this.store.setStoreId(cart.storeId);
		return cart;
	}

	/**
	 * Forget the remembered cart id. The store id stays: it belongs to the
	 * shop, not the cart, and a thank-you page keys its `purchase` event on it
	 * after the cart is gone.
	 */
	private async forget(): Promise<void> {
		await this.store.clearCartId();
	}

	/**
	 * Forget the remembered cart id WITHOUT deleting the cart, so the next
	 * `add()` starts a fresh one. For a cart this shopper can no longer use
	 * (another customer's); `clear()` is the call for emptying a basket.
	 */
	async forgetCurrent(): Promise<void> {
		await this.forget();
	}
}
