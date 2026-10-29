import { describe, expect, it } from "vitest";
import type { Product, ProductVariant } from "../src/sdk/types/catalog.js";
import {
	buildPriceState,
	buildVariantMatrix,
	clearOptionValue,
	getOptionGroups,
	resolveVariant,
	selectionForVariant,
	selectOptionValue,
} from "../src/state/variant-matrix.js";

const COLOR = 2;
const SIZE = 3;
const RED = 5;
const BLACK = 9;
const L = 6;
const XL = 7;
const XXL = 8;

function variant(
	id: number,
	sku: string,
	color: number,
	size: number,
	price: number | null,
	overrides: Partial<ProductVariant> = {},
): ProductVariant {
	const names: Record<number, string> = {
		[RED]: "Red",
		[BLACK]: "Black",
		[L]: "L",
		[XL]: "XL",
		[XXL]: "XXL",
	};
	return {
		id,
		sku,
		barcode: null,
		weight: null,
		hidden: null,
		minPurchaseQty: null,
		maxPurchaseQty: null,
		price: { price, comparePrice: null },
		stock: { stock: null, preorder: null },
		options: [
			{ id: color, name: names[color] ?? null, position: 1, optionId: COLOR },
			{ id: size, name: names[size] ?? null, position: 1, optionId: SIZE },
		],
		...overrides,
	};
}

/**
 * `prod_27`: a DELIBERATELY non-rectangular matrix (Red has no XXL) with one
 * variant priced differently (Black/XXL).
 * Every interesting bug in a variant picker lives in those two facts.
 */
function complexProduct(): Product {
	return {
		id: "prod_27",
		name: "Complex Product",
		price: 9900,
		description: null,
		slug: "complex-product",
		visible: true,
		taxRate: 25,
		seoTitle: null,
		seoDescription: null,
		images: [],
		options: [
			{ id: COLOR, name: "Color", position: 1 },
			{ id: SIZE, name: "Size", position: 2 },
		],
		variants: [
			variant(5, "Red-L", RED, L, 9900),
			variant(6, "Red-XL", RED, XL, 9900),
			variant(8, "Black-L", BLACK, L, 9900),
			variant(9, "Black-XL", BLACK, XL, 9900),
			variant(10, "Black-XXL", BLACK, XXL, 99900),
		],
	};
}

function simpleProduct(): Product {
	return {
		...complexProduct(),
		id: "prod_1",
		options: [],
		variants: [
			{
				...variant(1, "simple", RED, L, 28700),
				options: [],
			},
		],
	};
}

function valueState(
	groups: ReturnType<typeof buildVariantMatrix>,
	optionId: number,
	valueId: number,
) {
	const group = groups.find((g) => g.id === optionId);
	const value = group?.values.find((v) => v.id === valueId);
	if (!value) throw new Error(`no value ${valueId} in option ${optionId}`);
	return value;
}

describe("getOptionGroups", () => {
	it("returns the declared groups in position order", () => {
		expect(getOptionGroups(complexProduct()).map((g) => g.name)).toEqual([
			"Color",
			"Size",
		]);
	});

	it("derives groups from the variants when the product omits them", () => {
		const product = { ...complexProduct(), options: undefined };
		expect(getOptionGroups(product).map((g) => g.id)).toEqual([COLOR, SIZE]);
	});

	it("is empty for a product with no options", () => {
		expect(getOptionGroups(simpleProduct())).toEqual([]);
	});
});

describe("buildVariantMatrix — availability", () => {
	it("marks every value available when nothing is selected", () => {
		const groups = buildVariantMatrix(complexProduct(), {});
		for (const group of groups) {
			for (const value of group.values) expect(value.available).toBe(true);
		}
	});

	it("lists all values of a group, in position order", () => {
		const groups = buildVariantMatrix(complexProduct(), {});
		expect(groups.map((g) => g.name)).toEqual(["Color", "Size"]);
		expect(valueState(groups, COLOR, RED).name).toBe("Red");
		expect(groups[1]?.values.map((v) => v.name)).toEqual(["L", "XL", "XXL"]);
	});

	it("selecting Red makes XXL unavailable but keeps it listed", () => {
		// The heart of it: Red exists only in L and XL. XXL must still render (so
		// the row does not change length) but must not be clickable-as-available.
		const groups = buildVariantMatrix(complexProduct(), { [COLOR]: RED });

		expect(valueState(groups, SIZE, L).available).toBe(true);
		expect(valueState(groups, SIZE, XL).available).toBe(true);
		expect(valueState(groups, SIZE, XXL).available).toBe(false);
		expect(groups[1]?.values).toHaveLength(3);
	});

	it("selecting Black makes all three sizes available", () => {
		const groups = buildVariantMatrix(complexProduct(), { [COLOR]: BLACK });

		expect(valueState(groups, SIZE, L).available).toBe(true);
		expect(valueState(groups, SIZE, XL).available).toBe(true);
		expect(valueState(groups, SIZE, XXL).available).toBe(true);
	});

	it("narrows in the other direction too: XXL makes Red unavailable", () => {
		const groups = buildVariantMatrix(complexProduct(), { [SIZE]: XXL });

		expect(valueState(groups, COLOR, RED).available).toBe(false);
		expect(valueState(groups, COLOR, BLACK).available).toBe(true);
	});

	it("never lets a group's own selection invalidate its other values", () => {
		// With Red selected, Black must still be available — otherwise the shopper
		// could never switch colour.
		const groups = buildVariantMatrix(complexProduct(), { [COLOR]: RED });

		expect(valueState(groups, COLOR, RED).selected).toBe(true);
		expect(valueState(groups, COLOR, BLACK).available).toBe(true);
		expect(valueState(groups, COLOR, BLACK).selected).toBe(false);
	});

	it("reports which variants a value still reaches", () => {
		const groups = buildVariantMatrix(complexProduct(), { [COLOR]: BLACK });
		expect(valueState(groups, SIZE, XXL).variantIds).toEqual([10]);
	});

	it("excludes hidden variants from availability", () => {
		const product = complexProduct();
		product.variants = product.variants.map((v) =>
			v.id === 10 ? { ...v, hidden: true } : v,
		);
		const groups = buildVariantMatrix(product, { [COLOR]: BLACK });

		expect(valueState(groups, SIZE, XXL).available).toBe(false);
	});
});

describe("selectOptionValue", () => {
	it("adds a choice", () => {
		const next = selectOptionValue(complexProduct(), {}, COLOR, RED);
		expect(next).toEqual({ [COLOR]: RED });
	});

	it("keeps a compatible earlier choice", () => {
		const product = complexProduct();
		const next = selectOptionValue(product, { [SIZE]: L }, COLOR, RED);
		expect(next).toEqual({ [SIZE]: L, [COLOR]: RED });
	});

	it("clears the contradicting choice instead of refusing the click", () => {
		// Black/XXL selected, then Red clicked: Red has no XXL. The shopper's most
		// recent intent (Red) must win, and the size must be dropped for re-pick —
		// not left as a dead end where nothing is clickable.
		const product = complexProduct();
		const next = selectOptionValue(
			product,
			{ [COLOR]: BLACK, [SIZE]: XXL },
			COLOR,
			RED,
		);

		expect(next).toEqual({ [COLOR]: RED });
		expect(resolveVariant(product, next)).toBeNull();
	});

	it("clears in the other direction too", () => {
		const product = complexProduct();
		const next = selectOptionValue(
			product,
			{ [COLOR]: RED, [SIZE]: L },
			SIZE,
			XXL,
		);
		expect(next).toEqual({ [SIZE]: XXL });
	});

	it("switching between two compatible colours keeps the size", () => {
		const product = complexProduct();
		const next = selectOptionValue(
			product,
			{ [COLOR]: RED, [SIZE]: XL },
			COLOR,
			BLACK,
		);
		expect(next).toEqual({ [COLOR]: BLACK, [SIZE]: XL });
		expect(resolveVariant(product, next)?.sku).toBe("Black-XL");
	});
});

describe("resolveVariant", () => {
	it("is null while the selection is incomplete", () => {
		const product = complexProduct();
		expect(resolveVariant(product, {})).toBeNull();
		expect(resolveVariant(product, { [COLOR]: RED })).toBeNull();
	});

	it("resolves a complete selection", () => {
		const product = complexProduct();
		expect(resolveVariant(product, { [COLOR]: BLACK, [SIZE]: XXL })?.id).toBe(
			10,
		);
	});

	it("is null for a complete but non-existent combination", () => {
		const product = complexProduct();
		expect(resolveVariant(product, { [COLOR]: RED, [SIZE]: XXL })).toBeNull();
	});

	it("resolves the single variant of a product with no options", () => {
		expect(resolveVariant(simpleProduct(), {})?.sku).toBe("simple");
	});
});

describe("selectionForVariant", () => {
	it("round-trips a variant id into a complete selection", () => {
		const product = complexProduct();
		const selection = selectionForVariant(product, 10);
		expect(selection).toEqual({ [COLOR]: BLACK, [SIZE]: XXL });
		expect(resolveVariant(product, selection)?.id).toBe(10);
	});

	it("is empty for an unknown variant id", () => {
		expect(selectionForVariant(complexProduct(), 999)).toEqual({});
	});
});

describe("clearOptionValue", () => {
	it("removes one group and leaves the rest", () => {
		expect(clearOptionValue({ [COLOR]: RED, [SIZE]: L }, COLOR)).toEqual({
			[SIZE]: L,
		});
	});
});

describe("buildPriceState", () => {
	it("shows a range before anything is selected", () => {
		const price = buildPriceState(complexProduct(), {});
		expect(price.amount).toBeNull();
		expect(price.min).toBe(9900);
		expect(price.max).toBe(99900);
		expect(price.isRange).toBe(true);
	});

	it("collapses the range once the selection excludes the outlier", () => {
		// Red reaches only the 99 kr variants, so the "from" label must disappear
		// even though no variant is pinned yet.
		const price = buildPriceState(complexProduct(), { [COLOR]: RED });
		expect(price.amount).toBeNull();
		expect(price.min).toBe(9900);
		expect(price.max).toBe(9900);
		expect(price.isRange).toBe(false);
	});

	it("gives the exact price once a variant resolves", () => {
		const price = buildPriceState(complexProduct(), {
			[COLOR]: BLACK,
			[SIZE]: XXL,
		});
		expect(price.amount).toBe(99900);
		expect(price.isRange).toBe(false);
	});

	it("updates when the selection moves to a differently-priced variant", () => {
		const product = complexProduct();
		const cheap = buildPriceState(product, { [COLOR]: BLACK, [SIZE]: L });
		const dear = buildPriceState(product, { [COLOR]: BLACK, [SIZE]: XXL });

		expect(cheap.amount).toBe(9900);
		expect(dear.amount).toBe(99900);
	});

	it("falls back to the product price when a variant carries none", () => {
		const product = complexProduct();
		product.variants = product.variants.map((v) =>
			v.id === 10 ? { ...v, price: { price: null, comparePrice: null } } : v,
		);
		const price = buildPriceState(product, { [COLOR]: BLACK, [SIZE]: XXL });
		expect(price.amount).toBe(9900);
	});

	it("surfaces a compare-at price from the selected variant", () => {
		const product = complexProduct();
		product.variants = product.variants.map((v) =>
			v.id === 5 ? { ...v, price: { price: 7900, comparePrice: 9900 } } : v,
		);
		const price = buildPriceState(product, { [COLOR]: RED, [SIZE]: L });
		expect(price.amount).toBe(7900);
		expect(price.compareAtAmount).toBe(9900);
	});

	it("uses the product price for a product with no variant prices", () => {
		const price = buildPriceState(simpleProduct(), {});
		expect(price.amount).toBe(28700);
		expect(price.isRange).toBe(false);
	});
});
