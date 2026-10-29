import { beforeEach, describe, expect, it, vi } from "vitest";
import { configure } from "../../src/elements/index.js";
import type { Product } from "../../src/sdk/types/catalog.js";
import { createFakeFetch, TEST_KEY } from "../helpers.js";
import {
	$,
	$$,
	at,
	ensureDefined,
	flush,
	mountWithProduct,
	PRODUCT,
	resetDom,
	SIMPLE_PRODUCT,
	text,
} from "./helpers.js";

ensureDefined();

/**
 * The template below is the whole point of this suite: it names no option type.
 * "Color" and "Size" appear nowhere in the markup — both the groups and their
 * values come out of the product, so the same template renders a two-option
 * product, a one-option product and a product with none.
 */
const DYNAMIC_PICKER = `
	<qb-product>
		<qb-options>
			<template>
				<fieldset>
					<legend data-qb-text="group.name"></legend>
					<qb-option-values>
						<template>
							<button data-qb-action="select" data-qb-text="value.name"></button>
						</template>
					</qb-option-values>
				</fieldset>
			</template>
		</qb-options>
		<span id="sku" data-qb-text="variant.sku"></span>
		<span id="price" data-qb-text="price.display"></span>
	</qb-product>
`;

async function picker(product: Product = PRODUCT): Promise<HTMLElement> {
	configure({
		// Consent and analytics are on by default; this suite tests the
		// elements without them (they have their own suites).
		consent: false,
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		fetch: createFakeFetch([]).fetch,
		currency: "SEK",
		locale: "sv-SE",
		maxRetries: 0,
	});
	return mountWithProduct(DYNAMIC_PICKER, product);
}

/** Set a `<select>` and fire the `change` a shopper's choice would. */
function choose(select: HTMLSelectElement, value: string): void {
	select.value = value;
	select.dispatchEvent(new Event("change", { bubbles: true }));
}

function values(host: ParentNode, groupName: string): HTMLButtonElement[] {
	const group = $$(host, "fieldset").find(
		(field) => field.querySelector("legend")?.textContent === groupName,
	);
	if (!group) throw new Error(`no group named ${groupName}`);
	return Array.from(group.querySelectorAll("button"));
}

function byLabel(
	host: ParentNode,
	groupName: string,
	label: string,
): HTMLButtonElement {
	const found = values(host, groupName).find(
		(button) => button.textContent === label,
	);
	if (!found) throw new Error(`no ${groupName} value ${label}`);
	return found;
}

describe("<qb-options> / <qb-option-values>", () => {
	beforeEach(resetDom);

	it("renders the product's own groups, without the markup naming any", async () => {
		const host = await picker();

		const legends = $$(host, "legend").map((node) => node.textContent);
		expect(legends).toEqual(["Color", "Size"]);
	});

	it("renders each group's own values", async () => {
		const host = await picker();

		expect(values(host, "Color").map((b) => b.textContent)).toEqual([
			"Red",
			"Black",
		]);
		expect(values(host, "Size").map((b) => b.textContent)).toEqual([
			"L",
			"XL",
			"XXL",
		]);
	});

	it("renders nothing for a product with no options, from the same template", async () => {
		const host = await picker(SIMPLE_PRODUCT);

		expect($$(host, "fieldset")).toHaveLength(0);
		expect($(host, "qb-options").hasAttribute("empty")).toBe(true);
		// …and the simple product is immediately complete.
		expect(text(host, "#sku")).toBe("simple");
	});

	it("follows a product whose groups are different ones entirely", async () => {
		const host = await picker();
		const material = 42;
		const other: Product = {
			...PRODUCT,
			id: "prod_99",
			options: [{ id: material, name: "Material", position: 1 }],
			variants: [
				{
					...at(PRODUCT.variants, 0),
					id: 77,
					sku: "wool",
					options: [{ id: 100, name: "Wool", position: 1, optionId: material }],
				},
			],
		};

		($(host, "qb-product") as HTMLElement & { product: Product }).product =
			other;
		await flush();

		// A template that had hardcoded option="Color" would render nothing here.
		expect($$(host, "legend").map((n) => n.textContent)).toEqual(["Material"]);
		expect(values(host, "Material").map((b) => b.textContent)).toEqual([
			"Wool",
		]);
	});

	it("selects a value on click and resolves the variant", async () => {
		const host = await picker();

		byLabel(host, "Color", "Black").click();
		await flush();
		expect(text(host, "#sku")).toBe("");

		byLabel(host, "Size", "XXL").click();
		await flush();
		expect(text(host, "#sku")).toBe("Black-XXL");
	});

	it("reflects selection and availability on the row for CSS", async () => {
		const host = await picker();

		byLabel(host, "Color", "Red").click();
		await flush();

		const red = byLabel(host, "Color", "Red");
		expect(red.getAttribute("data-selected")).toBe("true");
		expect(red.getAttribute("aria-pressed")).toBe("true");

		// Red has no XXL, so XXL must report unavailable — for the stylesheet to
		// dim. It stays clickable: see `reflectValue`.
		const xxl = byLabel(host, "Size", "XXL");
		expect(xxl.getAttribute("data-available")).toBe("false");
		expect(xxl.disabled).toBe(false);

		const xl = byLabel(host, "Size", "XL");
		expect(xl.getAttribute("data-available")).toBe("true");
	});

	it("evaluates availability from the other groups, both ways round", async () => {
		const host = await picker();

		// Picking XXL first must make Red unavailable — the mirror of the case
		// above. A matrix that only looked one way would pass one and fail this.
		byLabel(host, "Size", "XXL").click();
		await flush();

		expect(byLabel(host, "Color", "Red").getAttribute("data-available")).toBe(
			"false",
		);
		expect(byLabel(host, "Color", "Black").getAttribute("data-available")).toBe(
			"true",
		);
	});

	it("repairs a contradicting choice instead of refusing it", async () => {
		const host = await picker();
		byLabel(host, "Color", "Black").click();
		byLabel(host, "Size", "XXL").click();
		await flush();
		expect(text(host, "#sku")).toBe("Black-XXL");

		// Red/XXL does not exist. The new choice wins and the old one is dropped,
		// rather than the click doing nothing.
		byLabel(host, "Color", "Red").click();
		await flush();

		expect(byLabel(host, "Color", "Red").getAttribute("data-selected")).toBe(
			"true",
		);
		expect(byLabel(host, "Size", "XXL").getAttribute("data-selected")).toBe(
			"false",
		);
		expect(text(host, "#sku")).toBe("");
	});

	it("shows a price range until a variant is pinned", async () => {
		const host = await picker();
		expect(text(host, "#price")).toMatch(/99,00.*999,00/);

		byLabel(host, "Color", "Black").click();
		byLabel(host, "Size", "XXL").click();
		await flush();

		expect(text(host, "#price")).toMatch(/^999,00/);
	});

	it("marks the product complete / incomplete for CSS", async () => {
		const host = await picker();
		const product = $(host, "qb-product");

		expect(product.hasAttribute("incomplete")).toBe(true);
		expect(product.hasAttribute("complete")).toBe(false);

		byLabel(host, "Color", "Black").click();
		byLabel(host, "Size", "XL").click();
		await flush();

		expect(product.hasAttribute("complete")).toBe(true);
		expect(product.hasAttribute("incomplete")).toBe(false);
	});

	it("keeps the same button elements across a selection change", async () => {
		const host = await picker();
		const before = byLabel(host, "Size", "XL");

		byLabel(host, "Color", "Black").click();
		await flush();

		// Keyed reconciliation: the row is updated in place, not rebuilt. A
		// rebuilt row would lose focus and any transition mid-flight.
		expect(byLabel(host, "Size", "XL")).toBe(before);
	});
});

describe("<qb-option-values> standalone", () => {
	beforeEach(resetDom);

	it("binds to the sole group of a one-option product with no attributes", async () => {
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: createFakeFetch([]).fetch,
			currency: "SEK",
			maxRetries: 0,
		});
		const oneOption: Product = {
			...PRODUCT,
			options: [{ id: 2, name: "Color", position: 1 }],
			variants: PRODUCT.variants.map((variant) => ({
				...variant,
				options: variant.options.filter((value) => value.optionId === 2),
			})),
		};
		const host = await mountWithProduct(
			`
				<qb-product>
					<qb-option-values>
						<template><button data-qb-action="select" data-qb-text="value.name"></button></template>
					</qb-option-values>
				</qb-product>
			`,
			oneOption,
		);

		expect($$(host, "button").map((b) => b.textContent)).toEqual([
			"Red",
			"Black",
		]);
	});

	it("warns rather than guessing when the product has several groups", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: createFakeFetch([]).fetch,
			currency: "SEK",
			maxRetries: 0,
		});
		const host = await mountWithProduct(
			`
			<qb-product>
				<qb-option-values>
					<template><button data-qb-text="value.name"></button></template>
				</qb-option-values>
			</qb-product>
			`,
			PRODUCT,
		);

		expect($$(host, "button")).toHaveLength(0);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("2 option groups"),
		);
		warn.mockRestore();
	});

	it("still honours an explicit option name as an escape hatch", async () => {
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: createFakeFetch([]).fetch,
			currency: "SEK",
			maxRetries: 0,
		});
		const host = await mountWithProduct(
			`
			<qb-product>
				<qb-option-values option="Size">
					<template><button data-qb-text="value.name"></button></template>
				</qb-option-values>
			</qb-product>
			`,
			PRODUCT,
		);

		expect($$(host, "button").map((b) => b.textContent)).toEqual([
			"L",
			"XL",
			"XXL",
		]);
	});
});

describe("data-qb-select-options", () => {
	beforeEach(resetDom);

	it("fills an author-written <select> from the group and selects on change", async () => {
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: createFakeFetch([]).fetch,
			currency: "SEK",
			maxRetries: 0,
		});
		const host = await mountWithProduct(
			`
			<qb-product>
				<qb-options>
					<template>
						<label>
							<span data-qb-text="group.name"></span>
							<select data-qb-select-options>
								<option value="">Välj…</option>
							</select>
						</label>
					</template>
				</qb-options>
				<span id="sku" data-qb-text="variant.sku"></span>
			</qb-product>
			`,
			PRODUCT,
		);

		const selects = $$(host, "select") as HTMLSelectElement[];
		const colour = at(selects, 0);
		const size = at(selects, 1);

		// The author's placeholder survives; the values come from the product.
		expect(Array.from(colour.options).map((o) => o.textContent)).toEqual([
			"Välj…",
			"Red",
			"Black",
		]);

		choose(colour, "9"); // Black
		await flush();
		choose(size, "8"); // XXL
		await flush();

		expect(text(host, "#sku")).toBe("Black-XXL");
	});
});
