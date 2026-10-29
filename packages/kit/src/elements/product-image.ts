import {
	buildImageSrcSet,
	type ImageTransform,
	pickProductImage,
	resolveProductImageUrl,
} from "../media/image-url.js";
import type {
	Product,
	ProductImage as ProductImageRecord,
} from "../sdk/types/catalog.js";
import { QbElement } from "./base.js";
import { type ProductContextValue, productContext } from "./product.js";
import type { ShopContextValue } from "./shop-context.js";

/**
 * `<qb-product-image>` — a product image as a real `<img>`, with the URL
 * actually resolved.
 *
 * It renders its own markup because `product.images[0].path` is **not** a URL:
 * it is the bare storage filename, and rendering it directly gives a broken
 * image.
 *
 * ```html
 * <!-- inside <qb-product> or a <qb-product-list> row: no attributes needed -->
 * <qb-product-image width="800" height="800"></qb-product-image>
 *
 * <!-- a gallery -->
 * <qb-product-image index="1" width="120"></qb-product-image>
 * ```
 *
 * It creates exactly one `<img>` and nothing around it, reused across updates
 * so a swapped variant does not flash. `img-class`, `img-sizes` and
 * `img-style` on the host are copied onto it.
 */
export class QbProductImageElement extends QbElement {
	static observedAttributes = [
		"index",
		"image-id",
		"width",
		"height",
		"alt",
		"sizes",
		"widths",
		"densities",
		"quality",
		"format",
		"fit",
		"priority",
		"include-pending",
		"img-class",
		"img-style",
		"img-sizes",
	];

	private shop: ShopContextValue | null = null;
	private explicitProduct: Product | null = null;
	private contextProduct: Product | null = null;
	private unsubscribeController: (() => void) | null = null;
	/**
	 * The controller currently subscribed to, so the listener is only swapped
	 * when it changes (swapping inside its notification loop would run it twice).
	 */
	private watchedController: unknown = undefined;
	private img: HTMLImageElement | null = null;

	/** The product to take the image from. Set by `<qb-product-list>` per row. */
	get product(): Product | null {
		return this.explicitProduct ?? this.contextProduct;
	}

	set product(product: Product | null) {
		this.explicitProduct = product;
		if (this.isStarted) this.render();
	}

	/** A specific image record. Wins over every other way of choosing one. */
	image: ProductImageRecord | null = null;

	protected start(): void {
		this.consume(productContext, (product: ProductContextValue) => {
			const changed = this.watchedController !== product.controller;
			this.watchedController = product.controller;
			this.contextProduct = product.controller?.product ?? null;
			if (changed) {
				this.unsubscribeController?.();
				this.unsubscribeController =
					product.controller?.subscribe(() => {
						this.contextProduct = product.controller?.product ?? null;
						this.render();
					}) ?? null;
			}
			this.render();
		});

		// Optional: an image record or product in hand needs no client, and
		// `imageBaseUrl` is only a fallback for older platform versions.
		try {
			this.withShop((shop) => {
				this.shop = shop;
				this.render();
			});
		} catch {
			this.shop = null;
		}

		this.cleanups.push(() => {
			this.unsubscribeController?.();
			this.unsubscribeController = null;
		});

		this.render();
	}

	protected update(): void {
		this.render();
	}

	protected stop(): void {
		this.img?.remove();
		this.img = null;
	}

	private render(): void {
		const product = this.product;
		const image =
			this.image ??
			pickProductImage(product, {
				index: this.numberAttr("index"),
				imageId: this.numberAttr("image-id"),
				includePending: this.boolAttr("include-pending"),
			});

		const width = this.numberAttr("width");
		const height = this.numberAttr("height");
		const urlOptions = {
			width,
			height,
			quality: this.numberAttr("quality"),
			format: this.attr("format") as ImageTransform["format"],
			fit: this.attr("fit") as ImageTransform["fit"],
			baseUrl: this.shop?.client.imageBaseUrl ?? null,
		};

		const src = resolveProductImageUrl(image, urlOptions);
		if (!src) {
			// No photo is not an error: drop the <img> and mark the host `empty`
			// so a CSS placeholder can take over.
			this.img?.remove();
			this.img = null;
			this.toggleAttr("empty", true);
			return;
		}
		this.toggleAttr("empty", false);

		const srcSet = buildImageSrcSet(image, {
			...urlOptions,
			widths: numberList(this.attr("widths")),
			densities: numberList(this.attr("densities")),
		});

		const img = this.ensureImg();
		setAttr(img, "src", src);
		setAttr(img, "srcset", srcSet);
		// Falls back to the image's own text, then the product name, then "".
		img.alt = this.attr("alt") ?? image?.altText ?? product?.name ?? "";
		setAttr(img, "width", width === undefined ? null : String(width));
		setAttr(img, "height", height === undefined ? null : String(height));
		setAttr(img, "sizes", this.attr("img-sizes") ?? this.attr("sizes") ?? null);
		setAttr(img, "class", this.attr("img-class") ?? null);
		setAttr(img, "style", this.attr("img-style") ?? null);

		const priority = this.boolAttr("priority");
		img.loading = priority ? "eager" : "lazy";
		img.decoding = "async";
		setAttr(img, "fetchpriority", priority ? "high" : null);
	}

	/** One `<img>`, reused so a re-render does not restart the download. */
	private ensureImg(): HTMLImageElement {
		if (this.img?.isConnected) return this.img;
		const img = document.createElement("img");
		this.replaceChildren(img);
		this.img = img;
		return img;
	}
}

function setAttr(element: Element, name: string, value: string | null): void {
	if (value === null || value === "") element.removeAttribute(name);
	else if (element.getAttribute(name) !== value)
		element.setAttribute(name, value);
}

/** `"400 800 1200"` or `"1,2"` → numbers. Undefined when unset. */
function numberList(raw: string | undefined): number[] | undefined {
	if (raw === undefined) return undefined;
	const parsed = raw
		.split(/[\s,]+/)
		.map(Number)
		.filter((value) => Number.isFinite(value) && value > 0);
	return parsed.length > 0 ? parsed : undefined;
}
