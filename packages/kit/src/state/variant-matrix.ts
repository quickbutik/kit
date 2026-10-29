import type {
	Product,
	ProductOptionType,
	ProductVariant,
} from "../sdk/types/catalog.js";
import type { MinorUnits } from "../sdk/types/common.js";

/**
 * Which option value is chosen in each option group, keyed by option id.
 * Partial until every group has a choice.
 */
export type VariantSelection = Record<number, number>;

export interface VariantOptionValueState {
	id: number;
	name: string | null;
	/** The option group this value belongs to ("Color"). */
	optionId: number;
	position: number | null;
	selected: boolean;
	/**
	 * Whether a purchasable variant exists for this value given the choices in
	 * the other groups (its own group is excluded). If Red exists only in L
	 * and XL, picking Red marks XXL unavailable, and vice versa.
	 */
	available: boolean;
	/** Ids of the variants this value still reaches. Useful for stock/price UI. */
	variantIds: number[];
}

export interface VariantOptionGroupState {
	id: number;
	name: string | null;
	position: number | null;
	values: VariantOptionValueState[];
	selectedValueId: number | null;
}

export interface VariantPriceState {
	/** The selected variant's price. Null until a variant is fully resolved. */
	amount: MinorUnits | null;
	/** "Before" price of the selected variant, for a struck-through comparison. */
	compareAtAmount: MinorUnits | null;
	/** Lowest price among the variants still reachable from the selection. */
	min: MinorUnits | null;
	/** Highest price among the variants still reachable from the selection. */
	max: MinorUnits | null;
	/** True when the reachable variants differ in price ("from 99 kr"). */
	isRange: boolean;
}

/**
 * A variant that exists and is not hidden. Stock is not considered (`null`
 * means untracked); a UI can read `stock` off the variants in `variantIds`.
 */
function isPurchasable(variant: ProductVariant): boolean {
	return variant.hidden !== true;
}

/**
 * The option groups for a product, in display order. Derived from the
 * variants when `product.options` is absent.
 */
export function getOptionGroups(product: Product): ProductOptionType[] {
	if (product.options && product.options.length > 0) {
		return [...product.options].sort(byPosition);
	}
	const derived = new Map<number, ProductOptionType>();
	for (const variant of product.variants) {
		for (const value of variant.options ?? []) {
			if (value.optionId === null || derived.has(value.optionId)) continue;
			derived.set(value.optionId, {
				id: value.optionId,
				name: null,
				position: null,
			});
		}
	}
	return [...derived.values()].sort(byPosition);
}

/** Whether `variant` carries every (optionId → valueId) pair in `selection`. */
export function variantMatchesSelection(
	variant: ProductVariant,
	selection: VariantSelection,
): boolean {
	for (const [optionId, valueId] of Object.entries(selection)) {
		const wanted = Number(optionId);
		const has = (variant.options ?? []).some(
			(value) => value.optionId === wanted && value.id === valueId,
		);
		if (!has) return false;
	}
	return true;
}

/**
 * The variant a selection identifies, or null until every group is chosen
 * (even if a partial selection matches only one variant). A product with no
 * option groups resolves to its single variant.
 */
export function resolveVariant(
	product: Product,
	selection: VariantSelection,
): ProductVariant | null {
	const groups = getOptionGroups(product);
	if (groups.length === 0) {
		return product.variants.find(isPurchasable) ?? product.variants[0] ?? null;
	}
	if (groups.some((group) => selection[group.id] === undefined)) return null;
	return (
		product.variants.find(
			(variant) =>
				isPurchasable(variant) && variantMatchesSelection(variant, selection),
		) ?? null
	);
}

/**
 * The full picker state: every group, every value, and whether each is selected
 * and still reachable.
 */
export function buildVariantMatrix(
	product: Product,
	selection: VariantSelection,
): VariantOptionGroupState[] {
	const groups = getOptionGroups(product);
	const purchasable = product.variants.filter(isPurchasable);

	return groups.map((group) => {
		// Availability for THIS group is judged against the other groups only.
		const otherSelections = omit(selection, group.id);
		const reachable = purchasable.filter((variant) =>
			variantMatchesSelection(variant, otherSelections),
		);

		const values = new Map<number, VariantOptionValueState>();
		// Values come from every variant, so unreachable ones are still reported
		// (`available: false`) and can be clicked to repair the selection.
		for (const variant of product.variants) {
			for (const value of variant.options ?? []) {
				if (value.optionId !== group.id) continue;
				const existing = values.get(value.id);
				if (existing) continue;
				values.set(value.id, {
					id: value.id,
					name: value.name,
					optionId: group.id,
					position: value.position,
					selected: selection[group.id] === value.id,
					available: false,
					variantIds: [],
				});
			}
		}

		for (const variant of reachable) {
			for (const value of variant.options ?? []) {
				if (value.optionId !== group.id) continue;
				const state = values.get(value.id);
				if (!state) continue;
				state.available = true;
				state.variantIds.push(variant.id);
			}
		}

		return {
			id: group.id,
			name: group.name,
			position: group.position,
			values: [...values.values()].sort(byPosition),
			selectedValueId: selection[group.id] ?? null,
		};
	});
}

/**
 * Apply a click on one option value, returning the next selection. Earlier
 * choices that contradict it are cleared rather than the click refused, so
 * picking Red while XXL is selected gives Red with the size to re-pick.
 */
export function selectOptionValue(
	product: Product,
	selection: VariantSelection,
	optionId: number,
	valueId: number,
): VariantSelection {
	const next: VariantSelection = { ...selection, [optionId]: valueId };
	const purchasable = product.variants.filter(isPurchasable);

	if (purchasable.some((variant) => variantMatchesSelection(variant, next))) {
		return next;
	}

	// Keep the new choice and drop older ones that cannot coexist with it.
	const repaired: VariantSelection = { [optionId]: valueId };
	for (const group of getOptionGroups(product)) {
		if (group.id === optionId) continue;
		const previous = selection[group.id];
		if (previous === undefined) continue;
		const candidate = { ...repaired, [group.id]: previous };
		if (
			purchasable.some((variant) => variantMatchesSelection(variant, candidate))
		) {
			repaired[group.id] = previous;
		}
	}
	return repaired;
}

/** Remove one group's choice, leaving the rest intact. */
export function clearOptionValue(
	selection: VariantSelection,
	optionId: number,
): VariantSelection {
	return omit(selection, optionId);
}

/** The selection that identifies a given variant, for deep links and prefills. */
export function selectionForVariant(
	product: Product,
	variantId: number,
): VariantSelection {
	const variant = product.variants.find(
		(candidate) => candidate.id === variantId,
	);
	if (!variant) return {};
	const selection: VariantSelection = {};
	for (const value of variant.options ?? []) {
		if (value.optionId === null) continue;
		selection[value.optionId] = value.id;
	}
	return selection;
}

/** The first purchasable variant, for storefronts that preselect one. */
export function firstAvailableVariant(product: Product): ProductVariant | null {
	return product.variants.find(isPurchasable) ?? null;
}

/**
 * Price for the current selection: the exact figure once a variant is
 * resolved, else the range across reachable variants. A variant without its
 * own price uses the product's.
 */
export function buildPriceState(
	product: Product,
	selection: VariantSelection,
): VariantPriceState {
	const selected = resolveVariant(product, selection);
	const reachable = product.variants
		.filter(isPurchasable)
		.filter((variant) => variantMatchesSelection(variant, selection));

	const prices = (reachable.length > 0 ? reachable : [])
		.map((variant) => variant.price.price ?? product.price)
		.filter((price): price is number => typeof price === "number");

	const min = prices.length > 0 ? Math.min(...prices) : product.price;
	const max = prices.length > 0 ? Math.max(...prices) : product.price;

	return {
		amount: selected ? (selected.price.price ?? product.price) : null,
		compareAtAmount: selected?.price.comparePrice ?? null,
		min,
		max,
		isRange: min !== null && max !== null && min !== max,
	};
}

function omit(selection: VariantSelection, optionId: number): VariantSelection {
	const out: VariantSelection = {};
	for (const [key, value] of Object.entries(selection)) {
		if (Number(key) === optionId) continue;
		out[Number(key)] = value;
	}
	return out;
}

/** Nulls last, so an unpositioned option does not jump to the front. */
function byPosition(
	a: { position: number | null },
	b: { position: number | null },
): number {
	if (a.position === null && b.position === null) return 0;
	if (a.position === null) return 1;
	if (b.position === null) return -1;
	return a.position - b.position;
}
