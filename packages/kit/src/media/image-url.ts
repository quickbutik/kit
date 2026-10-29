import type { Category, Product, ProductImage } from "../sdk/types/catalog.js";

/**
 * Turning Quickbutik's image records into `<img src>` values.
 *
 * Use an image's absolute `url`, not its `path`: `path` is a bare storage
 * filename and 404s on its own. `url` carries no resize parameters; the image
 * CDN takes imgix-compatible query params, which {@link applyImageTransform}
 * adds.
 */

/**
 * Resize/encode parameters for Quickbutik's image CDN (imgix-compatible).
 * Omitted params fall back to the CDN's defaults. In a local or preview
 * environment these may be ignored and images served full-size.
 */
export interface ImageTransform {
	/** Rendered width in CSS pixels → `w`. */
	width?: number;
	/** Rendered height in CSS pixels → `h`. */
	height?: number;
	/**
	 * Device pixel ratio → `dpr`. Multiplies `w`/`h` CDN-side. For responsive
	 * images prefer `densities` (see {@link buildImageSrcSet}).
	 */
	dpr?: number;
	/** JPEG/WebP quality, 1–100 → `q`. */
	quality?: number;
	/** Output format → `fm`, e.g. `"webp"`, `"avif"`, `"jpg"`, `"png"`. */
	format?: string;
	/** How the image fills `width`×`height` → `fit`. The CDN default is `clip`. */
	fit?: "clip" | "crop" | "fill" | "facearea" | "max" | "min" | "scale";
	/** Crop anchor → `crop`, e.g. `"faces,center"`. Only read when `fit: "crop"`. */
	crop?: string;
	/** Padding colour for `fit: "fill"` → `bg`. Hex without the `#`. */
	background?: string;
	/**
	 * Automatic optimisations → `auto`. Defaults to `"format"` (WebP/AVIF where
	 * supported). Pass `null` to send no `auto` at all.
	 */
	auto?: string | null;
}

export interface ProductImageUrlOptions extends ImageTransform {
	/**
	 * Fallback base URL for the shop's image storage, used only when an image
	 * has no absolute `url`. The shop-scoped base without the `products/`
	 * segment, e.g. `https://cdn.quickbutik.com/images/<shopPrefix>`. Usually
	 * set once as `imageBaseUrl` on the client config.
	 */
	baseUrl?: string | null;
	/**
	 * Append the image's `contentHash` as a `v` parameter so a replaced file is
	 * not served stale from the CDN. Default true.
	 */
	cacheBust?: boolean;
}

/** `contentHash` sentinel for an image whose binary has not been ingested yet. */
const PENDING_CONTENT_HASH = "temp";

const PRODUCT_IMAGE_FOLDER = "products";

const CATEGORY_IMAGE_FOLDER = "pages";

/**
 * The `<img src>` for one product image, or null when there is nothing to show.
 *
 * ```ts
 * const src = resolveProductImageUrl(product.images[0], { width: 600 })
 * // → https://cdn.quickbutik.com/images/ABC1/products/5c7…jpeg?auto=format&w=600&v=f1a2b3
 * ```
 */
export function resolveProductImageUrl(
	image: ProductImage | null | undefined,
	options: ProductImageUrlOptions = {},
): string | null {
	if (!image) return null;

	const base = absoluteImageUrl(
		image.url,
		image.path,
		options.baseUrl,
		PRODUCT_IMAGE_FOLDER,
	);
	if (!base) return null;

	return applyImageTransform(base, options, cacheBustFor(image, options));
}

/** The `<img src>` for a category's cover image, or null when it has none. */
export function resolveCategoryImageUrl(
	category: Pick<Category, "image" | "imageUrl"> | null | undefined,
	options: ProductImageUrlOptions = {},
): string | null {
	if (!category) return null;

	const base = absoluteImageUrl(
		category.imageUrl,
		category.image,
		options.baseUrl,
		CATEGORY_IMAGE_FOLDER,
	);
	if (!base) return null;

	return applyImageTransform(base, options);
}

export interface PickProductImageOptions {
	/** Position in display order. Defaults to 0 — the main image. */
	index?: number;
	/** Pick by image id instead of by position. Wins over `index`. */
	imageId?: number;
	/**
	 * Include images still being processed, whose URLs 404 until processing
	 * finishes. Default false.
	 */
	includePending?: boolean;
}

/**
 * One of a product's images, in the merchant's display order (by `position`,
 * nulls last, then array order).
 */
export function pickProductImage(
	product: Pick<Product, "images"> | null | undefined,
	options: PickProductImageOptions = {},
): ProductImage | null {
	const images = productImages(product, options.includePending);
	if (images.length === 0) return null;

	if (options.imageId !== undefined) {
		return images.find((image) => image.id === options.imageId) ?? null;
	}
	return images[options.index ?? 0] ?? null;
}

/** Every renderable image of a product, in display order. */
export function productImages(
	product: Pick<Product, "images"> | null | undefined,
	includePending = false,
): ProductImage[] {
	const images = product?.images ?? [];
	return images
		.filter((image) => isRenderable(image, includePending))
		.map((image, arrayIndex) => ({ image, arrayIndex }))
		.sort((a, b) => {
			const byPosition =
				positionOf(a.image.position) - positionOf(b.image.position);
			return byPosition !== 0 ? byPosition : a.arrayIndex - b.arrayIndex;
		})
		.map((entry) => entry.image);
}

export interface ImageSrcSetOptions extends ProductImageUrlOptions {
	/**
	 * Explicit candidate widths, emitted as `w` descriptors (`600w`) — pair with
	 * a `sizes` attribute. Wins over `densities`.
	 */
	widths?: readonly number[];
	/**
	 * Pixel ratios, emitted as `x` descriptors (`2x`). Defaults to `[1, 2]` when
	 * a `width` is known and no `widths` were given.
	 */
	densities?: readonly number[];
}

/**
 * A `srcSet` for one image, or null when there is nothing to build one from.
 * Use density descriptors (the default) for a fixed CSS size, and `widths`
 * plus `sizes` for an image that reflows with the viewport.
 */
export function buildImageSrcSet(
	image: ProductImage | null | undefined,
	options: ImageSrcSetOptions = {},
): string | null {
	const { widths, densities, ...transform } = options;

	if (widths && widths.length > 0) {
		const candidates = dedupeSorted(widths)
			.map((width) => {
				const url = resolveProductImageUrl(image, {
					...transform,
					width,
					height: scaleHeight(transform.width, transform.height, width),
					// A width descriptor already states the pixel count.
					dpr: undefined,
				});
				return url ? `${url} ${width}w` : null;
			})
			.filter((candidate): candidate is string => candidate !== null);
		return candidates.length > 0 ? candidates.join(", ") : null;
	}

	const ratios = dedupeSorted(densities ?? [1, 2]);
	// Without a width, `dpr` has nothing to scale.
	if (transform.width === undefined || ratios.length === 0) return null;

	const candidates = ratios
		.map((dpr) => {
			const url = resolveProductImageUrl(image, {
				...transform,
				dpr: dpr === 1 ? undefined : dpr,
			});
			return url ? `${url} ${dpr}x` : null;
		})
		.filter((candidate): candidate is string => candidate !== null);
	return candidates.length > 0 ? candidates.join(", ") : null;
}

/**
 * Add CDN transform parameters to an image URL, keeping any it already has.
 * For images this module does not otherwise cover, such as an og:image.
 */
export function applyImageTransform(
	url: string,
	transform: ImageTransform = {},
	cacheBust?: string | null,
): string {
	const params: Array<[string, string]> = [];

	const auto = transform.auto === undefined ? "format" : transform.auto;
	if (auto) params.push(["auto", auto]);
	if (transform.width !== undefined)
		params.push(["w", String(Math.round(transform.width))]);
	if (transform.height !== undefined)
		params.push(["h", String(Math.round(transform.height))]);
	if (transform.dpr !== undefined) params.push(["dpr", String(transform.dpr)]);
	if (transform.quality !== undefined)
		params.push(["q", String(transform.quality)]);
	if (transform.format !== undefined) params.push(["fm", transform.format]);
	if (transform.fit !== undefined) params.push(["fit", transform.fit]);
	if (transform.crop !== undefined) params.push(["crop", transform.crop]);
	if (transform.background !== undefined)
		params.push(["bg", transform.background]);
	if (cacheBust) params.push(["v", cacheBust]);

	if (params.length === 0) return url;

	const query = params
		.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
		.join("&");
	return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

/**
 * The renderable URL of a stored file, in order of preference: the absolute
 * `url`; a `path` that is already a full URL; `baseUrl` + folder + `path`;
 * a root-relative `path` when no `baseUrl` is set. Otherwise null.
 */
function absoluteImageUrl(
	url: string | null | undefined,
	path: string | null | undefined,
	baseUrl: string | null | undefined,
	folder: string,
): string | null {
	if (url) return url;
	if (!path) return null;
	if (hasOrigin(path)) return path;
	if (baseUrl) return joinUrl(baseUrl, folder, path);
	if (path.startsWith("/")) return path;
	return null;
}

function cacheBustFor(
	image: ProductImage,
	options: ProductImageUrlOptions,
): string | null {
	if (options.cacheBust === false) return null;
	const hash = image.contentHash;
	if (!hash || hash === PENDING_CONTENT_HASH) return null;
	return hash;
}

/**
 * Whether an image has a file yet. A pending image has no `url`/`path` or the
 * `temp` content hash.
 */
function isRenderable(image: ProductImage, includePending: boolean): boolean {
	if (!image.url && !image.path) return false;
	if (includePending) return true;
	return image.contentHash !== PENDING_CONTENT_HASH;
}

/** Nullable `position` sorts last rather than as zero. */
function positionOf(position: number | null): number {
	return position ?? Number.MAX_SAFE_INTEGER;
}

/** True for `https://host/…` and protocol-relative `//host/…`. */
function hasOrigin(path: string): boolean {
	return /^(https?:)?\/\//i.test(path);
}

function joinUrl(...parts: string[]): string {
	return parts
		.map((part, index) =>
			index === 0 ? part.replace(/\/+$/, "") : part.replace(/^\/+|\/+$/g, ""),
		)
		.filter((part) => part.length > 0)
		.join("/");
}

/** Keep the aspect ratio when a srcSet candidate overrides the width. */
function scaleHeight(
	width: number | undefined,
	height: number | undefined,
	candidateWidth: number,
): number | undefined {
	if (height === undefined) return undefined;
	if (width === undefined || width === 0) return height;
	return Math.round((height / width) * candidateWidth);
}

function dedupeSorted(values: readonly number[]): number[] {
	return [...new Set(values)]
		.filter((value) => Number.isFinite(value) && value > 0)
		.sort((a, b) => a - b);
}
