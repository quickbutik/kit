import type { CartItem } from "../sdk/types/cart.js";
import type { CartSnapshot } from "../state/cart-store.js";
import { delegateActions } from "./actions.js";
import { QbElement } from "./base.js";
import { bindRow, type Scope } from "./bindings.js";
import { Repeater } from "./repeat.js";
import { QbScopeElement } from "./scope.js";
import type { ShopContextValue } from "./shop-context.js";
import { cartItemScope, cartScope } from "./view-model.js";

/**
 * Shared plumbing for the cart elements: find the shop, subscribe to the
 * shared store, and load the remembered cart. Loading never creates a cart.
 */
abstract class CartAwareElement extends QbScopeElement {
	protected shop: ShopContextValue | null = null;
	protected snapshot: CartSnapshot | null = null;
	private unsubscribe: (() => void) | null = null;

	protected connectCart(): void {
		this.withShop((shop) => {
			this.shop = shop;
			this.unsubscribe?.();
			this.unsubscribe = shop.cartStore.subscribe(() => {
				this.snapshot = shop.cartStore.getSnapshot();
				this.render();
			});
			this.snapshot = shop.cartStore.getSnapshot();
			this.render();
			void shop.cartStore.load();
		});
		this.cleanups.push(() => {
			this.unsubscribe?.();
			this.unsubscribe = null;
		});
	}

	protected get locale(): string | undefined {
		return this.attr("locale") ?? this.shop?.locale;
	}

	protected ownScope(): Scope {
		return {
			...this.parentScope,
			...cartScope(
				this.snapshot?.cart ?? null,
				this.snapshot?.itemCount ?? 0,
				this.locale,
				this.attr("currency") ?? this.shop?.currency,
			),
			pending: this.snapshot?.pending ?? 0,
		};
	}

	protected reflectCartState(): void {
		const snapshot = this.snapshot;
		this.setState(snapshot?.status ?? "idle");
		this.toggleAttr("empty", (snapshot?.itemCount ?? 0) === 0);
		this.toggleAttr("pending", (snapshot?.pending ?? 0) > 0);
	}
}

/**
 * `<qb-cart>` — the shopper's basket as a scope for the markup inside it.
 *
 * ```html
 * <qb-cart>
 *   <p data-qb-show="cart.empty">Din varukorg är tom.</p>
 *   <qb-cart-items>
 *     <template>
 *       <li>
 *         <span data-qb-text="item.productTitle"></span>
 *         <span data-qb-text="item.variantName"></span>
 *         <input type="number" data-qb-quantity data-qb-value="item.quantity">
 *         <span data-qb-text="item.lineTotalFormatted"></span>
 *         <button data-qb-action="remove">Ta bort</button>
 *       </li>
 *     </template>
 *   </qb-cart-items>
 *   <strong data-qb-text="cart.totalFormatted"></strong>
 * </qb-cart>
 * ```
 *
 * Reflects `state`, `empty` and `pending` as attributes. Handles the `clear`
 * (alias `clear-cart`) and `refresh` actions. `clear` empties the basket —
 * deletes the remembered cart and forgets it — and does nothing when there is
 * no cart; a cart the server already dropped still ends up cleared.
 */
export class QbCartElement extends CartAwareElement {
	static observedAttributes = ["currency", "locale"];

	protected start(): void {
		this.initScope();
		const clear = (): void => {
			void this.shop?.cartStore.clear();
		};
		const actions = delegateActions(this, {
			clear,
			// Matches `useCart().clearCart` and `Quickbutik.clearCart()`.
			"clear-cart": clear,
			refresh: () => {
				void this.shop?.cartStore.refresh();
			},
		});
		this.cleanups.push(() => actions.dispose());
		this.connectCart();
	}

	protected update(): void {
		this.render();
	}

	protected render(): void {
		this.reflectCartState();
		super.render();
	}
}

/**
 * `<qb-cart-items>` — one `<template>` clone per cart line.
 *
 * Scope inside a row: everything on the API's `CartItem`, plus the formatted
 * money fields (`item.lineTotalFormatted`, `item.unitPriceFormatted`, …) and
 * `item.onSale`.
 *
 * Handles `remove`, `increment` and `decrement`, and binds any
 * `input[data-qb-quantity]` in the row to that line's quantity, committed on
 * `change` rather than on every keystroke.
 *
 * Rows are keyed by cart line id and reused across updates, so an input being
 * typed in keeps its value and caret.
 */
export class QbCartItemsElement extends CartAwareElement {
	static observedAttributes = ["currency", "locale"];

	private readonly repeater = new Repeater(this);
	private readonly rowScopes = new Map<string, Scope>();

	protected start(): void {
		this.initScope();

		const actions = delegateActions(this, {
			remove: (target) =>
				this.withItem(target, (item) => {
					void this.shop?.cartStore.removeItem(item.id);
				}),
			increment: (target) =>
				this.withItem(target, (item) => {
					void this.shop?.cartStore.updateItem(item.id, item.quantity + 1);
				}),
			decrement: (target) =>
				this.withItem(target, (item) => {
					void this.shop?.cartStore.updateItem(item.id, item.quantity - 1);
				}),
		});
		this.cleanups.push(() => actions.dispose());

		const onChange = (event: Event): void => {
			const input = event.target;
			if (!(input instanceof HTMLInputElement)) return;
			if (!input.matches("[data-qb-quantity]")) return;
			const item = this.itemFor(input);
			if (!item) return;
			const quantity = Number(input.value);
			if (!Number.isFinite(quantity)) {
				input.value = String(item.quantity);
				return;
			}
			void this.shop?.cartStore.updateItem(item.id, Math.trunc(quantity));
		};
		this.addEventListener("change", onChange);
		this.cleanups.push(() => this.removeEventListener("change", onChange));

		this.connectCart();
	}

	protected update(): void {
		this.render();
	}

	protected stop(): void {
		this.repeater.clear();
		this.rowScopes.clear();
	}

	protected scopeFor(requester: Element): Scope | undefined {
		const row = this.repeater.rowFor(requester);
		if (!row) return this.ownScope();
		return this.rowScopes.get(row.key) ?? this.ownScope();
	}

	protected render(): void {
		this.reflectCartState();

		const cart = this.snapshot?.cart ?? null;
		const items = cart?.items ?? [];
		const currency =
			cart?.currency ?? this.attr("currency") ?? this.shop?.currency;
		const parent = this.ownScope();
		this.rowScopes.clear();

		this.repeater.render(
			items,
			(item) => item.id,
			(row, item) => {
				const scope: Scope = {
					...parent,
					...cartItemScope(item, currency, this.locale),
				};
				this.rowScopes.set(row.key, scope);
				for (const root of row.roots) {
					root.setAttribute("data-item-id", item.id);
					root.setAttribute("data-available", String(item.available));
				}
				bindRow(row.roots, scope);
			},
		);

		super.render();
	}

	private itemFor(node: Element): CartItem | null {
		const row = this.repeater.rowFor(node);
		if (!row) return null;
		const scope = this.rowScopes.get(row.key);
		return ((scope?.item as CartItem | undefined) ?? null) as CartItem | null;
	}

	private withItem(target: Element, run: (item: CartItem) => void): void {
		const item = this.itemFor(target);
		if (item) run(item);
	}
}

/**
 * `<qb-cart-count>` — the badge. Sets its own text to the number of items.
 * `zero` is reflected so an empty badge can be hidden in CSS.
 *
 * ```html
 * <a href="/cart">Varukorg (<qb-cart-count></qb-cart-count>)</a>
 * ```
 */
export class QbCartCountElement extends QbElement {
	private shop: ShopContextValue | null = null;
	private unsubscribe: (() => void) | null = null;

	protected start(): void {
		this.withShop((shop) => {
			this.shop = shop;
			this.unsubscribe?.();
			this.unsubscribe = shop.cartStore.subscribe(() => this.render());
			this.render();
			void shop.cartStore.load();
		});
		this.cleanups.push(() => {
			this.unsubscribe?.();
			this.unsubscribe = null;
		});
	}

	private render(): void {
		const snapshot = this.shop?.cartStore.getSnapshot();
		const count = snapshot?.itemCount ?? 0;
		this.textContent = String(count);
		this.toggleAttr("zero", count === 0);
		this.setState(snapshot?.status ?? "idle");
	}
}
