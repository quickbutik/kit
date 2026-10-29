"use client";

import type { ReactNode } from "react";
import type { ProductVariant } from "../sdk/types/catalog.js";
import type {
	VariantOptionGroupState,
	VariantOptionValueState,
	VariantPriceState,
} from "../state/variant-matrix.js";
import {
	type ProductAddToCartState,
	useProductAddToCart,
	useProductOption,
	useProductOptions,
	useProductPrice,
	useProductState,
	useSelectedVariant,
} from "./product-context.js";

/**
 * Headless components for a variant picker. Each renders only what its
 * `children` function returns, and has a hook twin (`useProductOptions`,
 * `useProductPrice`, …) for use inside your own components.
 */

/** Render-prop props: `children` is a function, and nothing else is rendered. */
interface RenderProp<T> {
	children: (state: T) => ReactNode;
}

/**
 * Every option group.
 *
 * ```tsx
 * <ProductOptions>
 *   {(groups) => groups.map((group) => <MyGroup key={group.id} group={group} />)}
 * </ProductOptions>
 * ```
 */
export function ProductOptions({
	children,
}: RenderProp<VariantOptionGroupState[]>): ReactNode {
	return children(useProductOptions());
}

export interface ProductOptionGroupProps
	extends RenderProp<VariantOptionGroupState> {
	/** Option id, or its name ("Color", case-insensitive). */
	option: number | string;
	/** Rendered when the product has no such group. Defaults to nothing. */
	fallback?: ReactNode;
}

/**
 * One option group by id or name, for a layout that treats e.g. colour and
 * size differently. Renders `fallback` when the product has no such group.
 */
export function ProductOptionGroup({
	option,
	children,
	fallback = null,
}: ProductOptionGroupProps): ReactNode {
	const group = useProductOption(option);
	if (!group) return fallback;
	return children(group);
}

export interface ProductOptionValuesProps
	extends RenderProp<VariantOptionValueState> {
	option: number | string;
	fallback?: ReactNode;
}

/**
 * Each value of one group, one call per value — the tightest form for a row of
 * cards or swatches. `children` receives the value state (including `selected`
 * and `available`); keying is the caller's job, as with any mapped output.
 *
 * ```tsx
 * <ProductOptionValues option="Color">
 *   {(value) => <ColourCard key={value.id} value={value} />}
 * </ProductOptionValues>
 * ```
 */
export function ProductOptionValues({
	option,
	children,
	fallback = null,
}: ProductOptionValuesProps): ReactNode {
	const group = useProductOption(option);
	if (!group) return fallback;
	return group.values.map((value) => children(value));
}

/**
 * The resolved variant, or `fallback` while the selection is incomplete —
 * the natural place for "Select a size to continue".
 */
export function SelectedVariant({
	children,
	fallback = null,
}: RenderProp<ProductVariant> & { fallback?: ReactNode }): ReactNode {
	const variant = useSelectedVariant();
	if (!variant) return fallback;
	return children(variant);
}

/**
 * Price for the current selection. `amount` is null before a variant resolves,
 * with `min`/`max`/`isRange` describing what is still reachable.
 */
export function ProductPrice({
	children,
}: RenderProp<VariantPriceState & { currency?: string }>): ReactNode {
	return children(useProductPrice());
}

/** Add-to-cart bound to the selection, with its own disabled/pending state. */
export function AddToCart({
	children,
}: RenderProp<ProductAddToCartState>): ReactNode {
	return children(useProductAddToCart());
}

/**
 * Escape hatch: the entire product state in one call, for a layout that needs
 * several slices at once without nesting three render props.
 */
export function ProductConsumer({
	children,
}: RenderProp<ReturnType<typeof useProductState>>): ReactNode {
	return children(useProductState());
}
