import type { Product, ProductVariant } from "../sdk/types/catalog.js";
import {
	buildPriceState,
	buildVariantMatrix,
	clearOptionValue,
	firstAvailableVariant,
	getOptionGroups,
	resolveVariant,
	selectionForVariant,
	selectOptionValue,
	type VariantOptionGroupState,
	type VariantPriceState,
	type VariantSelection,
} from "./variant-matrix.js";

/** Everything derived from one product plus the shopper's current choices. */
export interface ProductSnapshot {
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
}

export interface ProductControllerOptions {
	/** Preselect this variant — a deep link, or a "recently viewed" restore. */
	initialVariantId?: number;
	/**
	 * Preselect the first purchasable variant instead of starting empty (which
	 * shows a price range). Default false.
	 */
	selectFirstAvailable?: boolean;
}

/**
 * The variant-selection state machine for one product, with no framework
 * attached. Holds only a `VariantSelection`; the snapshot is derived from it
 * and replaced on every change, so it works with `useSyncExternalStore`.
 */
export class ProductController {
	private listeners = new Set<() => void>();
	private snapshot: ProductSnapshot;
	private currentProduct: Product;
	private selection: VariantSelection;

	constructor(
		product: Product,
		private options: ProductControllerOptions = {},
	) {
		this.currentProduct = product;
		this.selection = initialSelection(product, options);
		this.snapshot = derive(product, this.selection);
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = (): ProductSnapshot => this.snapshot;

	get product(): Product {
		return this.currentProduct;
	}

	/**
	 * Point the controller at a different product, resetting the selection.
	 * A new object for the same product id keeps the shopper's choices.
	 */
	setProduct(product: Product, options?: ProductControllerOptions): void {
		if (product === this.currentProduct && options === undefined) return;

		// Same id keeps the selection; the snapshot is still re-derived.
		const sameId = product.id === this.currentProduct.id;
		this.currentProduct = product;
		if (options) this.options = options;
		if (!sameId) this.selection = initialSelection(product, this.options);
		this.publish();
	}

	/** Choose a value. Contradicting choices are cleared, not refused. */
	select(optionId: number, valueId: number): void {
		this.setSelection(
			selectOptionValue(this.currentProduct, this.selection, optionId, valueId),
		);
	}

	/** Unset one group's choice. */
	clear(optionId: number): void {
		this.setSelection(clearOptionValue(this.selection, optionId));
	}

	/** Unset every choice. */
	reset(): void {
		this.setSelection({});
	}

	/** Jump straight to a variant, e.g. from a `?variant=` deep link. */
	selectVariant(variantId: number): void {
		this.setSelection(selectionForVariant(this.currentProduct, variantId));
	}

	private setSelection(next: VariantSelection): void {
		this.selection = next;
		this.publish();
	}

	private publish(): void {
		this.snapshot = derive(this.currentProduct, this.selection);
		for (const listener of this.listeners) listener();
	}
}

function derive(
	product: Product,
	selection: VariantSelection,
): ProductSnapshot {
	const selectedVariant = resolveVariant(product, selection);
	const hasOptions = getOptionGroups(product).length > 0;
	return {
		product,
		options: buildVariantMatrix(product, selection),
		selection,
		selectedVariant,
		isComplete: !hasOptions || selectedVariant !== null,
		hasOptions,
		price: buildPriceState(product, selection),
	};
}

function initialSelection(
	product: Product,
	options: ProductControllerOptions,
): VariantSelection {
	if (options.initialVariantId !== undefined) {
		return selectionForVariant(product, options.initialVariantId);
	}
	if (options.selectFirstAvailable) {
		const first = firstAvailableVariant(product);
		return first ? selectionForVariant(product, first.id) : {};
	}
	return {};
}
