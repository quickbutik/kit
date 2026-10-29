import type { ConsentState } from "../../consent/types.js";
import { isBrowser } from "../../runtime/detect.js";
import type { AnalyticsContext, AnalyticsDestination } from "../destination.js";
import {
	type CommerceEvent,
	type CommerceItem,
	type PurchaseEvent,
	purchaseEventId,
} from "../events.js";
import { injectScript } from "../script.js";

export interface MetaPixelOptions {
	/** The numeric pixel id from the shop's tracking configuration. */
	pixelId: string;
}

type FbqFn = ((...args: unknown[]) => void) & {
	queue?: unknown[];
	callMethod?: (...args: unknown[]) => void;
	push?: unknown;
	loaded?: boolean;
	version?: string;
};

interface MetaWindow extends Window {
	fbq?: FbqFn;
	_fbq?: FbqFn;
}

/**
 * Pixel ids already `init`ed on this page, so a second destination for the
 * same pixel does not re-init or send a second `PageView`.
 */
const initialized = new Set<string>();

/**
 * The Meta Pixel, hard-gated on `marketing`: nothing (not even the script)
 * loads before the shopper grants it, and nothing more is sent after they
 * withdraw it. GA4 event names map to Meta's standard events:
 *
 * | kit event        | Meta event                  |
 * | ---------------- | --------------------------- |
 * | `page_view`      | `PageView`                  |
 * | `view_item`      | `ViewContent`               |
 * | `view_item_list` | `ViewCategory` (custom)     |
 * | `search`         | `Search`                    |
 * | `add_to_cart`    | `AddToCart`                 |
 * | `begin_checkout` | `InitiateCheckout`          |
 * | `add_payment_info` | `AddPaymentInfo`          |
 * | purchase         | `Purchase` with `eventID`   |
 *
 * Meta's consent API follows the decision (`fbq("consent", "grant" |
 * "revoke")`), so a withdrawal also stops the pixel's cookies.
 *
 * `remove_from_cart` and the shipping step have no Meta equivalent and are
 * dropped. The purchase `eventID` is `purchase_{storeId}_{orderNumber}`, the
 * id the platform's server-side events use, so Meta merges them; with no
 * store id the `Purchase` carries no `eventID`.
 */
export function metaPixelDestination(
	options: MetaPixelOptions,
): AnalyticsDestination {
	const pixelId = options.pixelId.trim();
	let loaded = false;
	// One id per page load for every non-purchase event. Safe: Meta only
	// deduplicates a browser event against a server event, never two
	// browser events.
	const pageEventId = `pv_${Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000}`;

	const fbq = (): FbqFn | null => {
		if (!loaded || !isBrowser()) return null;
		return (window as MetaWindow).fbq ?? null;
	};

	return {
		id: "meta",
		key: `meta:${pixelId}`,
		requires: "marketing",

		load(): void {
			if (loaded || !isBrowser() || !pixelId) return;
			loaded = true;
			const w = window as MetaWindow;
			const fn = ensureFbq(w);
			injectScript("https://connect.facebook.net/en_US/fbevents.js", "meta");
			if (!initialized.has(pixelId)) {
				initialized.add(pixelId);
				fn("consent", "grant");
				fn("init", pixelId);
				fn("track", "PageView", {}, { eventID: pageEventId });
			}
		},

		onConsent(state: ConsentState | null): void {
			fbq()?.(
				"consent",
				state === null || state.marketing ? "grant" : "revoke",
			);
		},

		track(event: CommerceEvent, context: AnalyticsContext): void {
			const fn = fbq();
			if (!fn) return;
			const params = event.params;
			const items = Array.isArray(params.items)
				? (params.items as CommerceItem[])
				: [];
			const meta = { eventID: pageEventId };
			switch (event.name) {
				case "page_view":
					fn("track", "PageView", {}, meta);
					return;
				case "view_item":
					fn(
						"track",
						"ViewContent",
						{
							content_type: "product",
							content_ids: contentIds(items),
							...(items[0]?.item_name
								? { content_name: items[0].item_name }
								: {}),
							...money(params),
						},
						meta,
					);
					return;
				case "view_item_list":
					fn(
						"trackCustom",
						"ViewCategory",
						{
							content_type: "product",
							content_ids: contentIds(items).slice(0, 10),
							...(typeof params.item_list_name === "string"
								? { content_name: params.item_list_name }
								: {}),
						},
						meta,
					);
					return;
				case "search":
					fn(
						"track",
						"Search",
						{
							search_string: params.search_term ?? "",
							content_type: "product",
							...(items.length > 0
								? { content_ids: contentIds(items).slice(0, 5) }
								: {}),
						},
						meta,
					);
					return;
				case "add_to_cart":
					fn(
						"track",
						"AddToCart",
						{
							...basket(items),
							...(items[0]?.item_name
								? { content_name: items[0].item_name }
								: {}),
							...money(params),
						},
						meta,
					);
					return;
				case "begin_checkout":
					fn(
						"track",
						"InitiateCheckout",
						{ ...basket(items), ...money(params) },
						meta,
					);
					return;
				case "add_payment_info":
					fn("track", "AddPaymentInfo", money(params), meta);
					return;
				case "purchase": {
					// A plain purchase event comes from the embedded checkout's
					// confirmation. Its eventID is rebuilt the same way as
					// `trackPurchase`'s so it merges with a server-side `Purchase`;
					// without a store id none is sent, leaving Meta its own matching.
					const orderNumber = params.transaction_id;
					if (orderNumber === undefined || orderNumber === null) return;
					const data = { ...basket(items), ...money(params) };
					if (context.storeId) {
						fn("track", "Purchase", data, {
							eventID: purchaseEventId(context.storeId, String(orderNumber)),
						});
					} else {
						fn("track", "Purchase", data);
					}
					return;
				}
				default:
					return;
			}
		},

		trackPurchase(
			purchase: PurchaseEvent,
			{ eventId }: { eventId: string },
		): void {
			const fn = fbq();
			if (!fn) return;
			fn(
				"track",
				"Purchase",
				{
					...basket(purchase.items),
					value: purchase.value,
					currency: purchase.currency,
				},
				{ eventID: eventId },
			);
		},
	};
}

/**
 * The fbevents stub: queue calls on `window.fbq` until the script sets
 * `callMethod`. A page that already carries the pixel keeps its `fbq`.
 */
function ensureFbq(w: MetaWindow): FbqFn {
	if (w.fbq) return w.fbq;
	const fn = ((...args: unknown[]) => {
		const self = w.fbq as FbqFn;
		if (self.callMethod) self.callMethod(...args);
		else self.queue?.push(args);
	}) as FbqFn;
	fn.queue = [];
	fn.loaded = true;
	fn.version = "2.0";
	fn.push = fn;
	w.fbq = fn;
	w._fbq = fn;
	return fn;
}

function contentIds(items: CommerceItem[]): string[] {
	return [...new Set(items.map((item) => String(item.item_id)))];
}

/**
 * Meta's basket shape. `num_items` counts units, not lines; `content_ids` is
 * deduped (variants share a product id); `contents` keeps per-line detail.
 */
function basket(items: CommerceItem[]) {
	const contents = items.map((item) => ({
		id: String(item.item_id),
		quantity: item.quantity ?? 1,
		...(typeof item.price === "number" ? { item_price: item.price } : {}),
	}));
	return {
		content_type: "product",
		content_ids: contentIds(items),
		contents,
		num_items: contents.reduce((sum, line) => sum + line.quantity, 0),
	};
}

function money(params: CommerceEvent["params"]) {
	return {
		...(typeof params.value === "number" ? { value: params.value } : {}),
		...(typeof params.currency === "string"
			? { currency: params.currency }
			: {}),
	};
}

/** Forget which pixels were initialised. For tests. */
export function resetMetaPixels(): void {
	initialized.clear();
}
