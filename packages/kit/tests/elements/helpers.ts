import { resetGoogleTags } from "../../src/analytics/destinations/google-tag.js";
import { resetMetaPixels } from "../../src/analytics/destinations/meta-pixel.js";
import { resetInjectedScripts } from "../../src/analytics/script.js";
import { resetAmbientConsent } from "../../src/elements/consent-context.js";
import { defineElements } from "../../src/elements/index.js";
import { resetAmbientShop } from "../../src/elements/shop-context.js";
import { createMemoryStorage } from "../../src/runtime/storage.js";
import { createShopkitClient } from "../../src/sdk/client.js";
import type { Product, ProductVariant } from "../../src/sdk/types/catalog.js";
import { TEST_KEY } from "../helpers.js";
import { clearScopeOwners, resetCurrencyWarning } from "./internals.js";

export const COLOR = 2;
export const SIZE = 3;
export const RED = 5;
export const BLACK = 9;
export const L = 6;
export const XL = 7;
export const XXL = 8;

const VALUE_NAMES: Record<number, string> = {
	[RED]: "Red",
	[BLACK]: "Black",
	[L]: "L",
	[XL]: "XL",
	[XXL]: "XXL",
};

function variant(
	id: number,
	sku: string,
	color: number,
	size: number,
	price: number,
): ProductVariant {
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
			{
				id: color,
				name: VALUE_NAMES[color] ?? null,
				position: 1,
				optionId: COLOR,
			},
			{
				id: size,
				name: VALUE_NAMES[size] ?? null,
				position: 1,
				optionId: SIZE,
			},
		],
	};
}

/**
 * `prod_27` — two option groups, and a deliberately non-rectangular matrix:
 * Red has no XXL, so picking Red must report XXL unavailable and vice versa.
 */
export const PRODUCT: Product = {
	id: "prod_27",
	name: "Complex Product",
	price: 9900,
	description: "<strong>Nice</strong> tee",
	slug: "complex-product",
	visible: true,
	taxRate: 25,
	seoTitle: null,
	seoDescription: null,
	images: [
		{
			id: 1,
			productId: 27,
			url: "https://cdn.quickbutik.com/images/shop123/products/tee.jpeg",
			path: "tee.jpeg",
			position: 1,
			date: null,
			altText: "A tee",
			contentHash: "abc",
		},
	],
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

/** A product with no options at all — the simple-product path. */
export const SIMPLE_PRODUCT: Product = {
	...PRODUCT,
	id: "prod_1",
	name: "Simple Product",
	slug: "simple-product",
	options: [],
	variants: [
		{
			id: 1,
			sku: "simple",
			barcode: null,
			weight: null,
			hidden: null,
			minPurchaseQty: null,
			maxPurchaseQty: null,
			price: { price: 28700, comparePrice: null },
			stock: { stock: null, preorder: null },
			options: [],
		},
	],
};

export function makeClient(fetchImpl: typeof globalThis.fetch) {
	return createShopkitClient({
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		checkoutUrl: "https://checkout.test",
		fetch: fetchImpl,
		storage: createMemoryStorage(),
		maxRetries: 0,
	});
}

/**
 * The elements are registered once for the whole run.
 *
 * `customElements.define` cannot be undone, so a per-test registration would
 * throw on the second file — and the registry is idempotent precisely so this
 * is safe to call from every suite.
 */
export function ensureDefined(): void {
	defineElements({ warnOnUnhandledActions: false });
}

/**
 * A clean document, a forgotten ambient shop, and empty storage.
 *
 * Storage matters: the elements use the real cookie/localStorage adapters, so a
 * cart id remembered by one test would make the next one resolve a cart that
 * its fetch double knows nothing about — which fails as a missing POST several
 * assertions later.
 */
export function resetDom(): void {
	document.body.innerHTML = "";
	for (const tag of document.head.querySelectorAll("[data-qb-seo]")) {
		tag.remove();
	}
	// The analytics destinations leave vendor script tags in <head> and stubs on
	// `window`; a hub from one test must not make the next one's "loaded only
	// after consent" assertion pass for free.
	for (const tag of document.querySelectorAll("[data-qb-analytics]")) {
		tag.remove();
	}
	resetAmbientShop();
	resetAmbientConsent();
	resetInjectedScripts();
	resetGoogleTags();
	resetMetaPixels();
	const w = window as unknown as Record<string, unknown>;
	delete w.dataLayer;
	delete w.gtag;
	delete w.fbq;
	delete w._fbq;
	resetCurrencyWarning();
	try {
		localStorage.clear();
	} catch {
		// No localStorage in this environment; nothing to clear.
	}
	for (const cookie of document.cookie.split(";")) {
		const name = cookie.split("=")[0]?.trim();
		// biome-ignore lint/suspicious/noDocumentCookie: expiring a cookie is exactly what the raw setter is for, and CookieStore is not in happy-dom.
		if (name) document.cookie = `${name}=; max-age=0; path=/`;
	}
}

export { clearScopeOwners };

/**
 * Mount markup and let the elements start.
 *
 * `setup` runs synchronously right after insertion, before anything is
 * awaited — which is where a page assigning `el.product = …` would do it, and
 * the only place that beats the elements' own deferred start.
 */
export async function mount(
	html: string,
	setup?: (host: HTMLElement) => void,
): Promise<HTMLElement> {
	const host = document.createElement("div");
	host.innerHTML = html;
	document.body.append(host);
	setup?.(host);
	await flush();
	return host;
}

/** Mount a tree whose `<qb-product>` is handed a product object directly. */
export async function mountWithProduct(
	html: string,
	product: Product,
): Promise<HTMLElement> {
	return mount(html, (host) => {
		const element = host.querySelector("qb-product") as
			| (HTMLElement & { product: Product | null })
			| null;
		if (element) element.product = product;
	});
}

/** Let queued microtasks, timers and settled promises land. */
export async function flush(times = 3): Promise<void> {
	for (let i = 0; i < times; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

export function $(root: ParentNode, selector: string): HTMLElement {
	const found = root.querySelector<HTMLElement>(selector);
	if (!found) throw new Error(`no element matching ${selector}`);
	return found;
}

export function $$(root: ParentNode, selector: string): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

export function text(root: ParentNode, selector: string): string {
	return ($(root, selector).textContent ?? "").trim();
}

/** The nth match, or a named failure — the alternative being a `!` per index. */
export function nth(
	root: ParentNode,
	selector: string,
	index: number,
): HTMLElement {
	const found = $$(root, selector)[index];
	if (!found) throw new Error(`no ${selector} at index ${index}`);
	return found;
}

/** An array element, or a named failure. */
export function at<T>(items: readonly T[], index: number): T {
	const found = items[index];
	if (found === undefined) throw new Error(`nothing at index ${index}`);
	return found;
}
