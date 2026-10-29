"use client";

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import { viewItemEvent } from "../analytics/events.js";
import { ShopkitConfigError } from "../sdk/errors.js";
import type { StartCheckoutInput } from "../sdk/resources/checkout.js";
import type { Cart, CartItemPropertyInput } from "../sdk/types/cart.js";
import type { Product, ProductVariant } from "../sdk/types/catalog.js";
import { getProductPromise } from "../state/product-cache.js";
import { ProductController } from "../state/product-controller.js";
import type {
	VariantOptionGroupState,
	VariantPriceState,
	VariantSelection,
} from "../state/variant-matrix.js";
import { useOptionalAnalytics } from "./analytics.js";
import { ShopkitContext } from "./context.js";
import { useCart } from "./use-cart.js";
import { useCheckout } from "./use-checkout.js";
import { useClientCurrency } from "./use-currency.js";
import { usePromise } from "./use-promise.js";

export interface ProductState {
	product: Product;
	/** Option groups with per-value `selected` / `available` flags, in display order. */
	options: VariantOptionGroupState[];
	/** The raw selection, keyed by option id. Partial until every group is chosen. */
	selection: VariantSelection;
	/** The variant the selection identifies, or null while it is incomplete. */
	selectedVariant: ProductVariant | null;
	/** True once every option group has a choice (always true with no options). */
	isComplete: boolean;
	/** False for a simple product — render no picker. */
	hasOptions: boolean;
	/** Price for the current selection: exact figure, or a range before that. */
	price: VariantPriceState;
	/**
	 * The currency the product's prices are in — `product.currency`, else the
	 * `currency` passed to the provider — for the app's own formatting.
	 */
	currency?: string;
	/** Choose a value. Contradicting choices are cleared, not refused. */
	select: (optionId: number, valueId: number) => void;
	/** Unset one group's choice. */
	clear: (optionId: number) => void;
	/** Unset every choice. */
	reset: () => void;
	/** Jump straight to a variant, e.g. from a `?variant=` deep link. */
	selectVariant: (variantId: number) => void;
}

const ProductContext = createContext<ProductState | null>(null);

export interface ProductProviderProps {
	/**
	 * The product, or a promise for it. A promise (React 19) is unwrapped with
	 * `use()`, so a server component can start the fetch without awaiting and the
	 * nearest `<Suspense>` shows the fallback. Wins over `slug`/`id`.
	 */
	product?: Product | Promise<Product | null> | null;
	/**
	 * Look the product up by URL slug. Needs a `<ShopkitProvider>` and React 19's
	 * `use()`. The lookup walks the product list (there is no slug filter), so on
	 * a large catalog prefer resolving the product on the server and passing it.
	 */
	slug?: string;
	/** Look the product up by id — `"prod_27"` or `27`. One request. */
	id?: string | number;
	children: ReactNode;
	/**
	 * Rendered instead of `children` when the lookup finds nothing. Defaults to
	 * nothing; in Next.js, prefer `notFound()` at the page level for a real 404.
	 */
	notFound?: ReactNode;
	/** Preselect this variant — a deep link, or a "recently viewed" restore. */
	initialVariantId?: number;
	/**
	 * Preselect the first purchasable variant instead of starting empty (which
	 * shows a price range). Default false.
	 */
	selectFirstAvailable?: boolean;
	/** Fallback ISO 4217 code for display, when the product has no `currency`. */
	currency?: string;
	/** Called whenever the resolved variant changes, including to null. */
	onVariantChange?: (variant: ProductVariant | null) => void;
}

/**
 * Holds the variant selection for one product and derives everything from it.
 *
 * Renders no markup of its own; read it with the `useProduct*` hooks or the
 * render-prop components (`<ProductOptions>`, `<AddToCart>`, …).
 *
 * It also resolves the product for you, so a route can hand it a `slug`, an
 * `id`, or a promise instead of a loaded object:
 *
 * ```tsx
 * // app/products/[slug]/page.tsx
 * export default async function Page({ params }) {
 *   const { slug } = await params
 *   return (
 *     <Suspense fallback={<Skeleton />}>
 *       <ProductProvider slug={slug} notFound={<NotFound />}>
 *         <SEO />
 *         <VariantPicker />
 *       </ProductProvider>
 *     </Suspense>
 *   )
 * }
 * ```
 *
 * ```tsx
 * // …or with the product already in hand:
 * <ProductProvider product={product} currency="SEK">
 *   <MyColourCards />   // useProductOptions()
 *   <MyPrice />         // useProductPrice()
 *   <MyAddButton />     // useProductAddToCart()
 * </ProductProvider>
 * ```
 */
export function ProductProvider({
	product,
	slug,
	id,
	children,
	notFound = null,
	initialVariantId,
	selectFirstAvailable = false,
	currency,
	onVariantChange,
}: ProductProviderProps): ReactNode {
	const resolved = useResolvedProduct(product, slug, id);
	if (!resolved) return notFound;
	return (
		<ProductSelection
			product={resolved}
			initialVariantId={initialVariantId}
			selectFirstAvailable={selectFirstAvailable}
			currency={currency}
			onVariantChange={onVariantChange}
		>
			{children}
		</ProductSelection>
	);
}

/** The product this provider is for, whichever way it was named. */
function useResolvedProduct(
	product: Product | Promise<Product | null> | null | undefined,
	slug: string | undefined,
	id: string | number | undefined,
): Product | null {
	// Optional: a provider handed a resolved product needs no client.
	const shopkit = useContext(ShopkitContext);
	// Subscribed unconditionally, and passed to the lookup rather than read live
	// from the client, so a currency switch refetches and hydration matches SSR.
	const selected = useClientCurrency(shopkit?.client ?? null);

	// `use()` is the one hook allowed in a conditional; the lint rule predates it.
	// biome-ignore lint/correctness/useHookAtTopLevel: `use()` is permitted in conditionals, unlike every other hook.
	if (isPromise(product)) return usePromise(product);
	if (product) return product;

	if (slug === undefined && id === undefined) {
		throw new ShopkitConfigError(
			"shopkit: <ProductProvider> needs a `product`, a `slug` or an `id`.",
		);
	}
	if (!shopkit) {
		throw new ShopkitConfigError(
			"shopkit: looking a product up by slug/id needs a <ShopkitProvider> " +
				"above this component for the API client. Pass a resolved `product` " +
				"instead if you fetched it yourself.",
		);
	}

	// biome-ignore lint/correctness/useHookAtTopLevel: as above — conditional `use()` is by design.
	return usePromise(
		getProductPromise(
			shopkit.client,
			slug !== undefined
				? { slug, currency: selected }
				: { id: id as string | number, currency: selected },
		),
	);
}

function isPromise(
	value: Product | Promise<Product | null> | null | undefined,
): value is Promise<Product | null> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

/**
 * The selection state for a resolved product. Split from `ProductProvider` so
 * its hooks are never behind the conditional `use()`. The logic lives in
 * `ProductController`, shared with the `<qb-product>` custom element.
 */
function ProductSelection({
	product,
	children,
	initialVariantId,
	selectFirstAvailable = false,
	currency,
	onVariantChange,
}: Omit<ProductProviderProps, "product" | "slug" | "id" | "notFound"> & {
	product: Product;
}): ReactNode {
	const controller = useProductController(
		product,
		initialVariantId,
		selectFirstAvailable,
	);

	const snapshot = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
		// Server render: the snapshot the controller was constructed with, so SSR
		// and the first client paint agree on the initial variant.
		controller.getSnapshot,
	);

	// A revalidation replacing the product's data. Pushed in an effect, not during
	// render, so a discarded render cannot leave the controller on an uncommitted
	// product.
	useEffect(() => {
		controller.setProduct(product);
	}, [controller, product]);

	const actions = useMemo(
		() => ({
			select: (optionId: number, valueId: number) =>
				controller.select(optionId, valueId),
			clear: (optionId: number) => controller.clear(optionId),
			reset: () => controller.reset(),
			selectVariant: (variantId: number) => controller.selectVariant(variantId),
		}),
		[controller],
	);

	// Latest-ref so a caller passing an inline arrow does not re-fire the effect.
	const onVariantChangeRef = useRef(onVariantChange);
	onVariantChangeRef.current = onVariantChange;
	const lastNotified = useRef<number | null | undefined>(undefined);
	const { selectedVariant } = snapshot;
	useEffect(() => {
		const id = selectedVariant?.id ?? null;
		if (lastNotified.current === id) return;
		lastNotified.current = id;
		onVariantChangeRef.current?.(selectedVariant);
	}, [selectedVariant]);

	// The product's own currency first: its amounts are in it.
	const effectiveCurrency = snapshot.product.currency ?? currency;

	// `view_item` once per product id, so a revalidation and a StrictMode double
	// effect stay silent. The variant is whichever is selected on first mount.
	const analytics = useOptionalAnalytics();
	const viewed = useRef<string | null>(null);
	useEffect(() => {
		if (!analytics || viewed.current === product.id) return;
		viewed.current = product.id;
		analytics.track(viewItemEvent(product, selectedVariant, effectiveCurrency));
	}, [analytics, product, selectedVariant, effectiveCurrency]);

	const value = useMemo<ProductState>(
		() => ({ ...snapshot, currency: effectiveCurrency, ...actions }),
		[snapshot, effectiveCurrency, actions],
	);

	return (
		<ProductContext.Provider value={value}>{children}</ProductContext.Provider>
	);
}

/**
 * One controller per product id: another product's option ids would resolve a
 * variant that does not exist, so it is rebuilt rather than reset. Allocating
 * during render is safe; a discarded render discards it too.
 */
function useProductController(
	product: Product,
	initialVariantId: number | undefined,
	selectFirstAvailable: boolean,
): ProductController {
	const ref = useRef<ProductController | null>(null);
	const productIdRef = useRef(product.id);

	if (!ref.current || productIdRef.current !== product.id) {
		productIdRef.current = product.id;
		ref.current = new ProductController(product, {
			initialVariantId,
			selectFirstAvailable,
		});
	}
	return ref.current;
}

/** The whole product state. Throws outside a `<ProductProvider>`. */
export function useProductState(): ProductState {
	const value = useContext(ProductContext);
	if (!value) {
		throw new ShopkitConfigError(
			"shopkit: no <ProductProvider> above this component. Wrap the product " +
				"view in one to use the variant-picker hooks.",
		);
	}
	return value;
}

/**
 * The product state when there is a provider above, and null when there is not.
 * For components that also work outside one, like `<SEO />`.
 */
export function useOptionalProductState(): ProductState | null {
	return useContext(ProductContext);
}

/** The option groups to render as a picker. Empty for a simple product. */
export function useProductOptions(): VariantOptionGroupState[] {
	return useProductState().options;
}

/**
 * One option group by id or by name (case-insensitive), or null when the product
 * has no such group — so a component written for "Color" degrades quietly on a
 * product that has none.
 */
export function useProductOption(
	optionIdOrName: number | string,
): VariantOptionGroupState | null {
	const { options } = useProductState();
	return useMemo(() => {
		if (typeof optionIdOrName === "number") {
			return options.find((group) => group.id === optionIdOrName) ?? null;
		}
		const wanted = optionIdOrName.toLowerCase();
		return (
			options.find((group) => (group.name ?? "").toLowerCase() === wanted) ??
			null
		);
	}, [options, optionIdOrName]);
}

/** The resolved variant, or null while the selection is incomplete. */
export function useSelectedVariant(): ProductVariant | null {
	return useProductState().selectedVariant;
}

/**
 * Price for the current selection.
 *
 * `amount` is null until a variant is resolved; `min`/`max`/`isRange` describe
 * what is still reachable, which is what a "from …" label should read.
 */
export function useProductPrice(): VariantPriceState & { currency?: string } {
	const { price, currency } = useProductState();
	return useMemo(() => ({ ...price, currency }), [price, currency]);
}

export interface ProductAddToCartState {
	/**
	 * Add the selected variant. No-op (resolving to null) when nothing is
	 * selected. `properties` is the shopper's product-field input (see
	 * `Product.fields`); different input makes a separate cart line.
	 */
	addToCart: (
		quantity?: number,
		properties?: CartItemPropertyInput[],
	) => Promise<Cart | null>;
	/**
	 * False while the selection is incomplete, a mutation is in flight or a
	 * `buyNow` is under way.
	 */
	canAddToCart: boolean;
	/** Number of cart mutations in flight, from the shared cart store. */
	pending: number;
	error: Error | null;
	/** Which option groups still need a choice — for a "Select a size" prompt. */
	missingOptions: VariantOptionGroupState[];
	/**
	 * Add the selected variant and go straight to the hosted checkout. A no-op
	 * while the selection is incomplete, like {@link addToCart}. See
	 * `useCheckout().buyNow`.
	 */
	buyNow: (
		input: StartCheckoutInput,
		quantity?: number,
		properties?: CartItemPropertyInput[],
	) => Promise<void>;
	/** True while a `buyNow` is adding and starting the checkout. */
	buying: boolean;
	/** Why the last `buyNow` failed, or null. Separate from the cart's `error`. */
	buyNowError: Error | null;
}

/**
 * Add-to-cart wired to the current variant selection: a product with options
 * is not addable until a variant is chosen, and the variant id is sent.
 */
export function useProductAddToCart(): ProductAddToCartState {
	const { product, selectedVariant, hasOptions, options } = useProductState();
	const { add, pending, error } = useCart();

	const missingOptions = useMemo(
		() => options.filter((group) => group.selectedValueId === null),
		[options],
	);

	const addToCart = useCallback(
		async (quantity = 1, properties?: CartItemPropertyInput[]) => {
			if (hasOptions && !selectedVariant) return null;
			return add({
				productId: product.id,
				variantId: selectedVariant?.id,
				quantity,
				...(properties && { properties }),
			});
		},
		[add, product.id, selectedVariant, hasOptions],
	);

	const checkout = useCheckout();
	const checkoutBuyNow = checkout.buyNow;
	const buyNow = useCallback(
		async (
			input: StartCheckoutInput,
			quantity = 1,
			properties?: CartItemPropertyInput[],
		) => {
			if (hasOptions && !selectedVariant) return;
			await checkoutBuyNow(
				{
					productId: product.id,
					variantId: selectedVariant?.id,
					quantity,
					...(properties && { properties }),
				},
				input,
			);
		},
		[checkoutBuyNow, product.id, selectedVariant, hasOptions],
	);

	return {
		addToCart,
		canAddToCart:
			(!hasOptions || selectedVariant !== null) &&
			pending === 0 &&
			!checkout.starting,
		pending,
		error,
		missingOptions,
		buyNow,
		buying: checkout.starting,
		buyNowError: checkout.error,
	};
}
