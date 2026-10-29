import type { Shop } from "../sdk/types/shop.js";
import { buildSeo } from "../seo/build.js";
import { serializeJsonLd } from "../seo/json-ld.js";
import type { SeoDefaults, SeoInput, SeoTags } from "../seo/types.js";
import { QbElement } from "./base.js";
import { type ProductContextValue, productContext } from "./product.js";
import type { ShopContextValue } from "./shop-context.js";

/**
 * `<qb-seo>` — the page's `<head>`, built from the product it sits next to.
 *
 * ```html
 * <qb-product slug="cotton-tee">
 *   <qb-seo base-url="https://minbutik.se" product-path="/products/{slug}"></qb-seo>
 *   …
 * </qb-product>
 * ```
 *
 * Inside a `<qb-product>` it needs nothing else: the product comes from that
 * context, and the canonical from the `product-path` template. It writes the
 * title, description, canonical link, OpenGraph, Twitter card and schema.org
 * JSON-LD (price and availability included).
 *
 * Every tag it writes carries `data-qb-seo` and is replaced on update, so soft
 * navigation leaves no stale meta and the page's own `<head>` is untouched.
 *
 * A server-rendered page that already emits its head should use `buildSeo()`
 * from `@quickbutik/kit` in the renderer instead.
 */
export class QbSeoElement extends QbElement {
	static observedAttributes = [
		"base-url",
		"site-name",
		"title",
		"title-template",
		"description",
		"url",
		"locale",
		"currency",
		"product-path",
		"category-path",
		"default-image",
		"twitter-site",
		"twitter-creator",
		"no-index",
		"no-follow",
		"organization",
		"skip-title",
		"skip-json-ld",
	];

	private shop: ShopContextValue | null = null;
	private product: ProductContextValue | null = null;
	private shopData: Shop | null = null;
	private unsubscribeController: (() => void) | null = null;
	private written: Element[] = [];

	protected start(): void {
		this.consume(productContext, (product) => {
			const changed = this.product?.controller !== product.controller;
			this.product = product;
			if (changed) {
				this.unsubscribeController?.();
				this.unsubscribeController =
					product.controller?.subscribe(() => this.render()) ?? null;
			}
			this.render();
		});

		try {
			this.withShop((shop) => {
				this.shop = shop;
				this.render();
				void this.loadShop();
			});
		} catch {
			this.shop = null;
		}

		this.cleanups.push(() => {
			this.unsubscribeController?.();
			this.unsubscribeController = null;
			this.clearWritten();
		});

		this.render();
	}

	protected update(): void {
		this.render();
	}

	/**
	 * The shop record, for the site name, logo and Organization node. Failures
	 * are ignored.
	 */
	private async loadShop(): Promise<void> {
		if (this.shopData || !this.shop) return;
		try {
			this.shopData = await this.shop.client.shop.get();
			this.render();
		} catch {
			// Left null; every field it would have filled is optional.
		}
	}

	/** The resolved payload, for a page that wants the data rather than tags. */
	get tags(): SeoTags {
		return buildSeo({ ...this.defaults(), ...this.input() });
	}

	private defaults(): SeoDefaults {
		return {
			baseUrl: this.attr("base-url"),
			siteName: this.attr("site-name"),
			titleTemplate: this.attr("title-template"),
			locale: this.attr("locale"),
			defaultImage: this.attr("default-image"),
			twitterSite: this.attr("twitter-site"),
			twitterCreator: this.attr("twitter-creator"),
			currency: this.attr("currency") ?? this.shop?.currency,
			productPath: this.attr("product-path"),
			categoryPath: this.attr("category-path"),
			shop: this.shopData,
			organization: this.boolAttr("organization"),
		};
	}

	private input(): SeoInput {
		return {
			product: this.product?.controller?.product ?? null,
			title: this.attr("title"),
			description: this.attr("description"),
			url: this.attr("url"),
			noIndex: this.boolAttr("no-index"),
			noFollow: this.boolAttr("no-follow"),
		};
	}

	private render(): void {
		const tags = this.tags;
		this.clearWritten();

		if (!this.boolAttr("skip-title")) {
			// Replaced in place; the original is restored on disconnect.
			this.setTitle(tags.title);
		}

		if (tags.description) this.meta({ name: "description" }, tags.description);
		if (tags.canonical) this.link("canonical", tags.canonical);
		this.meta(
			{ name: "robots" },
			`${tags.robots.index ? "index" : "noindex"},${
				tags.robots.follow ? "follow" : "nofollow"
			}`,
		);

		const og = tags.openGraph;
		this.meta({ property: "og:title" }, og.title);
		if (og.description)
			this.meta({ property: "og:description" }, og.description);
		this.meta({ property: "og:type" }, og.type);
		if (og.url) this.meta({ property: "og:url" }, og.url);
		if (og.siteName) this.meta({ property: "og:site_name" }, og.siteName);
		if (og.locale) this.meta({ property: "og:locale" }, og.locale);
		for (const image of og.images) {
			this.meta({ property: "og:image" }, image.url);
		}
		if (og.images[0]?.alt) {
			this.meta({ property: "og:image:alt" }, og.images[0].alt);
		}
		if (og.price) {
			this.meta({ property: "product:price:amount" }, og.price.amount);
			this.meta({ property: "product:price:currency" }, og.price.currency);
		}
		if (og.availability) {
			this.meta({ property: "product:availability" }, og.availability);
		}

		const twitter = tags.twitter;
		this.meta({ name: "twitter:card" }, twitter.card);
		this.meta({ name: "twitter:title" }, twitter.title);
		if (twitter.description) {
			this.meta({ name: "twitter:description" }, twitter.description);
		}
		if (twitter.site) this.meta({ name: "twitter:site" }, twitter.site);
		if (twitter.creator)
			this.meta({ name: "twitter:creator" }, twitter.creator);
		if (twitter.images[0])
			this.meta({ name: "twitter:image" }, twitter.images[0]);

		for (const entry of tags.meta)
			this.meta({ name: entry.name }, entry.content);

		if (!this.boolAttr("skip-json-ld")) {
			for (const node of tags.jsonLd) this.jsonLd(node);
		}

		this.emit("seo", tags);
	}

	// Head writing

	private originalTitle: string | null = null;

	private setTitle(title: string): void {
		if (this.originalTitle === null) this.originalTitle = document.title;
		document.title = title;
	}

	private meta(attrs: Record<string, string>, content: string): void {
		const element = document.createElement("meta");
		for (const [name, value] of Object.entries(attrs)) {
			element.setAttribute(name, value);
		}
		element.setAttribute("content", content);
		this.append_(element);
	}

	private link(rel: string, href: string): void {
		const element = document.createElement("link");
		element.setAttribute("rel", rel);
		element.setAttribute("href", href);
		this.append_(element);
	}

	private jsonLd(node: Record<string, unknown>): void {
		const element = document.createElement("script");
		element.setAttribute("type", "application/ld+json");
		// `serializeJsonLd` escapes `<`, so a product name containing `</script>`
		// cannot break out of the tag.
		element.textContent = serializeJsonLd(node);
		this.append_(element);
	}

	private append_(element: Element): void {
		element.setAttribute("data-qb-seo", "");
		document.head.append(element);
		this.written.push(element);
	}

	private clearWritten(): void {
		for (const element of this.written.splice(0)) element.remove();
		if (this.originalTitle === null || this.isConnected) return;
		// Restore the page's own title. Guarded: during document teardown
		// `document.title` may no longer be writable.
		try {
			document.title = this.originalTitle;
		} catch {
			// The document is gone; there is no title left to restore.
		}
		this.originalTitle = null;
	}
}
