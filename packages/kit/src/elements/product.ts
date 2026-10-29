import { viewItemEvent } from "../analytics/events.js";
import type {
	BuyNowResult,
	StartCheckoutInput,
} from "../sdk/resources/checkout.js";
import type { Cart } from "../sdk/types/cart.js";
import type { Product } from "../sdk/types/catalog.js";
import { AsyncResource } from "../state/async-resource.js";
import { releaseOnRestore } from "../state/navigation-hold.js";
import { getProductPromise } from "../state/product-cache.js";
import { ProductController } from "../state/product-controller.js";
import { delegateActions } from "./actions.js";
import type { Scope } from "./bindings.js";
import { checkoutStartInput } from "./checkout.js";
import {
	type Context,
	type ContextProvider,
	createContext,
	provideContext,
} from "./context.js";
import { decorateHandoff } from "./handoff.js";
import { QbScopeElement } from "./scope.js";
import type { ShopContextValue } from "./shop-context.js";
import { productScope } from "./view-model.js";

/**
 * What the picker elements need from the product above them: unlike the
 * read-only scope, this is the handle `<qb-option-values>` uses to change the
 * selection. `controller` is null while the product is still loading;
 * subscribers are called again once it resolves.
 */
export interface ProductContextValue {
	controller: ProductController | null;
	currency?: string;
	locale?: string;
	addToCart(quantity?: number): Promise<Cart | null>;
	canAddToCart(): boolean;
	/**
	 * Add the selected variant and start the checkout without navigating.
	 * See {@link QbProductElement.buyNow}.
	 */
	buyNow(
		input: StartCheckoutInput | (() => StartCheckoutInput),
		quantity?: number,
	): Promise<BuyNowResult | null>;
}

export const productContext: Context<ProductContextValue> =
	createContext<ProductContextValue>("quickbutik:product");

/**
 * `<qb-product>` — one product, its variant selection, and everything derived
 * from the two.
 *
 * Resolves the product itself, so a page can name it by slug and write no
 * JavaScript at all:
 *
 * ```html
 * <qb-product slug="cotton-tee">
 *   <h1 data-qb-text="product.name"></h1>
 *   <p data-qb-text="price.display"></p>
 *   <qb-options>…</qb-options>
 *   <qb-add-to-cart><button>Lägg i varukorg</button></qb-add-to-cart>
 * </qb-product>
 * ```
 *
 * Renders no markup of its own. State is reflected as attributes —
 * `state="loading|ready|error"`, plus `empty`, `complete` / `incomplete` — so a
 * skeleton and a "choose a size first" hint are pure CSS. A product the page
 * already has can be assigned as a property (`el.product = product`).
 *
 * A `slug` lookup walks the catalog (the storefront API has no slug filter);
 * on a large catalog prefer resolving the product server-side.
 */
export class QbProductElement extends QbScopeElement {
	static observedAttributes = [
		"slug",
		"product-id",
		"variant-id",
		"select-first-available",
		"currency",
		"locale",
	];

	private shop: ShopContextValue | null = null;
	private controller: ProductController | null = null;
	private unsubscribeController: (() => void) | null = null;
	private readonly resource = new AsyncResource<Product | null>();
	private explicitProduct: Product | null = null;
	private productProvider: ContextProvider | null = null;

	/** A product you already have. Wins over `slug` / `product-id`. */
	get product(): Product | null {
		return this.controller?.product ?? null;
	}

	set product(product: Product | null) {
		this.explicitProduct = product;
		// Otherwise an in-flight lookup would replace the assigned product.
		this.resource.abort();
		if (product && this.isStarted) this.adopt(product);
	}

	/** The live selection state machine, for scripting a custom picker. */
	get selection(): ProductController | null {
		return this.controller;
	}

	protected start(): void {
		this.initScope();

		// Subscribed before any request can start, so no transition is missed.
		this.cleanups.push(
			this.resource.subscribe(() => {
				const { data, status } = this.resource.getSnapshot();
				if (status === "loading") this.setState("loading");
				else if (status === "error") this.setState("error");
				else if (status === "ready") {
					if (data) this.adopt(data);
					else this.notFound();
				}
			}),
		);
		this.cleanups.push(() => this.resource.abort());

		const actions = delegateActions(this, {
			"add-to-cart": (target) => {
				void this.addToCart(quantityFrom(target, this) ?? 1);
			},
			"buy-now": (target) => {
				void this.buyNowFrom(target);
			},
			reset: () => this.controller?.reset(),
		});
		this.cleanups.push(() => actions.dispose());

		this.withShop(
			(shop) => {
				// Prices come from the server in the requested currency, so a currency
				// switch re-reads the product, even one assigned as a property.
				const switched =
					this.shop === shop &&
					this.loadedCurrency !== undefined &&
					this.loadedCurrency !== shop.client.currency;
				this.shop = shop;
				this.loadedCurrency = shop.client.currency;
				if (switched && this.explicitProduct) {
					this.reprice(this.explicitProduct);
					return;
				}
				this.load();
			},
			{ refetchOnCurrencyChange: true },
		);
	}

	/** The client currency the product was last requested in. */
	private loadedCurrency: string | null | undefined;

	/**
	 * Re-read an assigned product in the client's new currency, keeping the
	 * assigned one if that fails.
	 */
	private reprice(product: Product): void {
		if (!this.shop) return;
		const client = this.shop.client;
		this.setState("loading");
		void this.resource.run(async () => {
			try {
				const fresh = await getProductPromise(client, { id: product.id });
				if (fresh && this.explicitProduct === product) {
					this.explicitProduct = fresh;
				}
				return fresh ?? product;
			} catch {
				return product;
			}
		});
	}

	/** Attributes that change which product this is; the rest only re-render. */
	private static readonly LOOKUP_ATTRIBUTES = new Set(["slug", "product-id"]);

	attributeChangedCallback(name: string): void {
		if (!this.isStarted) return;
		if (QbProductElement.LOOKUP_ATTRIBUTES.has(name)) {
			this.load();
			return;
		}
		if (name === "variant-id") {
			const variantId = this.numberAttr("variant-id");
			if (variantId !== undefined) this.controller?.selectVariant(variantId);
			return;
		}
		this.render();
	}

	protected stop(): void {
		this.unsubscribeController?.();
		this.unsubscribeController = null;
	}

	// Resolution

	private load(): void {
		if (this.explicitProduct) {
			this.adopt(this.explicitProduct);
			return;
		}
		const slug = this.attr("slug");
		const productId = this.attr("product-id");
		if (slug === undefined && productId === undefined) {
			// Not an error yet: `el.product` is often assigned right after
			// insertion. Warn only if nothing has arrived by the next macrotask.
			this.setState("idle");
			this.warnIfStillUnresolved();
			return;
		}
		if (!this.shop) return;

		const client = this.shop.client;
		this.setState("loading");
		void this.resource.run(() =>
			// Shared cache: elements naming the same product make one request.
			getProductPromise(
				client,
				slug !== undefined ? { slug } : { id: productId as string },
			),
		);
	}

	/** Warn once about a `<qb-product>` that names no product at all. */
	private warnIfStillUnresolved(): void {
		if (this.warnScheduled) return;
		this.warnScheduled = true;
		setTimeout(() => {
			if (!this.isConnected || this.controller || this.explicitProduct) return;
			if (this.attr("slug") ?? this.attr("product-id")) return;
			console.warn(
				"shopkit: <qb-product> has no `slug`, no `product-id` and no " +
					"`product` property, so there is nothing for it to show.",
			);
		}, 0);
	}

	private warnScheduled = false;

	private notFound(): void {
		this.unsubscribeController?.();
		this.unsubscribeController = null;
		this.controller = null;
		this.setState("ready");
		this.toggleAttr("empty", true);
		this.emit("product-not-found", {
			slug: this.attr("slug") ?? null,
			productId: this.attr("product-id") ?? null,
		});
		this.render();
	}

	private adopt(product: Product): void {
		const options = {
			initialVariantId: this.numberAttr("variant-id"),
			selectFirstAvailable: this.boolAttr("select-first-available"),
		};
		if (this.controller) {
			this.controller.setProduct(product, options);
		} else {
			this.controller = new ProductController(product, options);
		}
		// Not only on creation: a DOM move drops the subscription but keeps the
		// controller, so the shopper's selection survives.
		if (!this.unsubscribeController) {
			this.unsubscribeController = this.controller.subscribe(() => {
				this.render();
				this.emit("variant-change", {
					variant: this.controller?.getSnapshot().selectedVariant ?? null,
				});
			});
		}
		this.toggleAttr("empty", false);
		this.setState("ready");
		this.emit("product-change", { product });
		this.render();
		this.trackView();
	}

	/** The product id already reported as `view_item`. */
	private trackedViewId: string | null = null;

	/**
	 * `view_item`, once per product. A variant change is not a new view, so the
	 * event carries the variant selected when the product arrived.
	 */
	private trackView(): void {
		const analytics = this.shop?.analytics;
		const snapshot = this.controller?.getSnapshot();
		if (!analytics || !snapshot) return;
		if (this.trackedViewId === snapshot.product.id) return;
		this.trackedViewId = snapshot.product.id;
		analytics.track(
			viewItemEvent(
				snapshot.product,
				snapshot.selectedVariant ?? null,
				this.currency ?? null,
			),
		);
	}

	// Scope and context

	/**
	 * The currency prices are formatted in: the product's own (what its
	 * amounts are in), else the `currency` attribute, else the shop's
	 * configured fallback.
	 */
	private get currency(): string | undefined {
		return (
			this.controller?.product.currency ??
			this.attr("currency") ??
			this.shop?.currency
		);
	}

	private get locale(): string | undefined {
		return this.attr("locale") ?? this.shop?.locale;
	}

	protected ownScope(): Scope {
		if (!this.controller) return { ...this.parentScope, product: null };
		return {
			...this.parentScope,
			...productScope(
				this.controller.getSnapshot(),
				this.currency,
				this.locale,
			),
		};
	}

	protected initScope(): void {
		super.initScope();
		// Answers even before the product resolves, so early pickers are updated.
		this.productProvider = provideContext(this, productContext, () => ({
			controller: this.controller,
			currency: this.currency,
			locale: this.locale,
			addToCart: (quantity) => this.addToCart(quantity),
			canAddToCart: () => this.canAddToCart(),
			buyNow: (input, quantity) => this.buyNow(input, quantity),
		}));
		this.cleanups.push(() => {
			this.productProvider?.dispose();
			this.productProvider = null;
		});
	}

	protected render(): void {
		const snapshot = this.controller?.getSnapshot();
		// For CSS: "choose a size" hints and disabled buttons.
		this.toggleAttr("complete", snapshot?.isComplete === true);
		this.toggleAttr(
			"incomplete",
			snapshot !== undefined && !snapshot.isComplete,
		);
		super.render();
		this.productProvider?.update();
	}

	// Cart

	/** False while the selection is incomplete or a cart mutation is in flight. */
	canAddToCart(): boolean {
		const snapshot = this.controller?.getSnapshot();
		if (!snapshot) return false;
		const pending = this.shop?.cartStore.getSnapshot().pending ?? 0;
		return snapshot.isComplete && pending === 0;
	}

	/**
	 * Add the selected variant to the cart.
	 *
	 * Resolves to null without adding while the selection is incomplete, and
	 * emits `qb:add-to-cart-blocked` with the option groups still missing a
	 * choice so the page can prompt for them.
	 */
	async addToCart(quantity = 1): Promise<Cart | null> {
		const snapshot = this.controller?.getSnapshot();
		if (!snapshot || !this.shop) return null;
		if (snapshot.hasOptions && !snapshot.selectedVariant) {
			this.emit("add-to-cart-blocked", {
				missingOptions: snapshot.options.filter(
					(group) => group.selectedValueId === null,
				),
			});
			return null;
		}
		const cart = await this.shop.cartStore.add({
			productId: snapshot.product.id,
			variantId: snapshot.selectedVariant?.id,
			quantity,
		});
		if (cart) this.emit("added-to-cart", { cart, quantity });
		return cart;
	}

	/**
	 * Add the selected variant and start the hosted checkout ("Köp nu").
	 * Resolves to the handoff (`url` and all) and does NOT navigate; the
	 * `buy-now` verb and `<qb-buy-now>` do that.
	 *
	 * Resolves to null while the selection is incomplete (with the same
	 * `qb:add-to-cart-blocked` as {@link addToCart}) or while a previous call is
	 * in flight. Throws when the handoff fails. `input` may be a function,
	 * called only once those checks have passed.
	 */
	async buyNow(
		input: StartCheckoutInput | (() => StartCheckoutInput),
		quantity = 1,
	): Promise<BuyNowResult | null> {
		const snapshot = this.controller?.getSnapshot();
		if (!snapshot || !this.shop || this.buying) return null;
		if (snapshot.hasOptions && !snapshot.selectedVariant) {
			this.emit("add-to-cart-blocked", {
				missingOptions: snapshot.options.filter(
					(group) => group.selectedValueId === null,
				),
			});
			return null;
		}
		this.buying = true;
		this.toggleAttr("buying", true);
		try {
			return await this.shop.cartStore.buyNow(
				{
					productId: snapshot.product.id,
					variantId: snapshot.selectedVariant?.id,
					quantity,
				},
				typeof input === "function" ? input() : input,
			);
		} finally {
			this.buying = false;
			this.toggleAttr("buying", false);
		}
	}

	private buying = false;

	/**
	 * `data-qb-action="buy-now"` on a plain button: checkout options come from
	 * its `data-qb-success-url`, `data-qb-back-url` and `data-qb-theme`, and
	 * `data-qb-no-redirect` skips navigating. Emits `qb:checkout-started`.
	 */
	private async buyNowFrom(target: HTMLElement): Promise<void> {
		const data = target.dataset;
		// Lazy, so a blocked click does not also warn about a missing success-url.
		const input = (): StartCheckoutInput =>
			checkoutStartInput(
				(name) =>
					name === "success-url"
						? data.qbSuccessUrl
						: name === "back-url"
							? data.qbBackUrl
							: data.qbTheme,
				'a data-qb-action="buy-now" button',
				"data-qb-success-url",
			);
		try {
			const started = await this.buyNow(input, quantityFrom(target, this) ?? 1);
			if (!started) return;
			const result = decorateHandoff(started, this.shop);
			this.emit("checkout-started", result);
			if (data.qbNoRedirect === undefined) {
				// `assign`, not `replace`: back should return to this product.
				window.location.assign(result.url);
				// Hold `buying` until the navigation commits, so a second click
				// cannot add the item again. See `releaseOnRestore`.
				this.buying = true;
				this.toggleAttr("buying", true);
				releaseOnRestore(() => {
					this.buying = false;
					this.toggleAttr("buying", false);
				});
			}
		} catch (error) {
			// Not `fail()`: `state="error"` would mean the product did not load.
			const wrapped = error instanceof Error ? error : new Error(String(error));
			const context = "<qb-product> could not start the checkout";
			this.emit("error", { error: wrapped, context });
			console.error(`shopkit: ${context}`, wrapped);
		}
	}
}

/**
 * How many to add: `data-qb-quantity="3"` on the clicked element, or the
 * nearest `input[data-qb-quantity-input]` between it and `host` (so another
 * product card's input is never used).
 *
 * Returns `undefined`, not 1, when the markup says nothing about quantity, so
 * the caller's own default (such as `<qb-add-to-cart quantity="3">`) applies.
 */
export function quantityFrom(
	target: HTMLElement,
	host: Element,
): number | undefined {
	const own = Number(target.dataset.qbQuantity);
	if (Number.isFinite(own) && own > 0) return own;

	let node: Element | null = target;
	while (node) {
		const input = node.querySelector<HTMLInputElement>(
			"input[data-qb-quantity-input]",
		);
		if (input) {
			const typed = Number(input.value);
			return Number.isFinite(typed) && typed > 0 ? typed : 1;
		}
		if (node === host) break;
		node = node.parentElement;
	}
	return undefined;
}
