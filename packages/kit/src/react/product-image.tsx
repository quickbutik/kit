"use client";

import {
	type ComponentPropsWithoutRef,
	type ReactNode,
	useContext,
} from "react";
import {
	buildImageSrcSet,
	type ImageTransform,
	pickProductImage,
	resolveProductImageUrl,
} from "../media/image-url.js";
import type { ShopkitClient } from "../sdk/client.js";
import { ShopkitConfigError } from "../sdk/errors.js";
import type {
	Product,
	ProductImage as ProductImageRecord,
} from "../sdk/types/catalog.js";
import { getProductPromise } from "../state/product-cache.js";
import { ShopkitContext } from "./context.js";
import { useOptionalProductState } from "./product-context.js";
import { usePromise } from "./use-promise.js";

/**
 * Which image to show, and at what size. Shared by `<ProductImage />` and
 * {@link useProductImage}.
 */
export interface ProductImageOptions {
	/**
	 * The product to take the image from — a prefixed id (`"prod_27"`) or a raw
	 * number. Omit it inside a `<ProductProvider>` to use the provider's product.
	 * Outside one it needs a `<ShopkitProvider>` and React 19, and suspends while
	 * fetching (put a `<Suspense>` above it).
	 */
	productId?: string | number;
	/** Look the product up by slug instead of by id. See the note on `productId`. */
	slug?: string;
	/** A product you already have — no context, no lookup. Wins over `productId`. */
	product?: Product | null;
	/** A specific image record. Wins over every other way of choosing one. */
	image?: ProductImageRecord | null;
	/** Which image, in display order. Defaults to 0 — the main image. */
	index?: number;
	/** Pick by image id rather than by position. */
	imageId?: number;
	/** Include images whose file is still being processed. Off by default. */
	includePending?: boolean;
	/**
	 * Rendered width in CSS pixels. Drives the CDN resize, the `srcSet` and the
	 * `<img width>` that reserves the space before the bytes land.
	 */
	width?: number;
	/** Rendered height in CSS pixels. Set both to reserve layout space. */
	height?: number;
	/**
	 * Pixel ratios for the `srcSet`. Defaults to `[1, 2]` when `width` is set.
	 * Pass `[]` for no `srcSet` at all.
	 */
	densities?: readonly number[];
	/**
	 * Candidate widths for the `srcSet`, as `w` descriptors — for an image that
	 * reflows with the viewport. Pair it with `sizes`. Wins over `densities`.
	 */
	widths?: readonly number[];
	/** Quality, format, fit, crop — see {@link ImageTransform}. */
	transform?: ImageTransform;
	/**
	 * Alt text. Defaults to the image's `altText`, then the product name, then
	 * `""` (right for an image that repeats an adjacent product title).
	 */
	alt?: string;
	/** Skip the `contentHash` cache-buster. See `ProductImageUrlOptions`. */
	cacheBust?: boolean;
}

/** What {@link useProductImage} resolved. */
export interface ProductImageState {
	/** The product the image came from, when one was resolvable. */
	product: Product | null;
	/** The chosen image record, or null when the product has no usable image. */
	image: ProductImageRecord | null;
	/** Absolute, sized `src`. Null when there is no image to show. */
	src: string | null;
	/** Matching `srcSet`, or null when one would add nothing. */
	srcSet: string | null;
	alt: string;
	width?: number;
	height?: number;
}

/**
 * Resolve a product image to a ready-to-render `src` / `srcSet` / `alt`.
 *
 * The hook twin of `<ProductImage />`, for a renderer this component cannot be
 * — `next/image`, a background-image, an og:image:
 *
 * ```tsx
 * const { src, alt, width, height } = useProductImage({ width: 800 })
 * return src ? <Image src={src} alt={alt} width={width} height={height} /> : null
 * ```
 */
export function useProductImage(
	options: ProductImageOptions = {},
): ProductImageState {
	const { product, imageBaseUrl } = useImageProduct(options);
	return resolveImageState(product, options, imageBaseUrl);
}

export interface ProductImageProps
	extends ProductImageOptions,
		Omit<
			ComponentPropsWithoutRef<"img">,
			"src" | "srcSet" | "width" | "height" | "alt"
		> {
	/**
	 * Rendered when the product has no image — a placeholder box, or nothing.
	 * Defaults to nothing, so a missing image never becomes a broken one.
	 */
	fallback?: ReactNode;
	/**
	 * Above the fold: load eagerly at high priority instead of lazily. Use it
	 * for the one image that is the page's largest contentful paint, never for
	 * a grid.
	 */
	priority?: boolean;
}

/**
 * A product image as an `<img>`, with the URL actually resolved.
 *
 * `product.images[0].path` is not a URL but a bare storage filename; rendering
 * it directly gives a broken image. This resolves the full CDN URL.
 *
 * ```tsx
 * // Inside a <ProductProvider> — the main image, no props needed:
 * <ProductImage width={800} height={800} />
 *
 * // In a product card, from a listing:
 * <ProductImage product={product} width={400} height={400} className="thumb" />
 *
 * // A gallery:
 * {product.images.map((image) => (
 *   <ProductImage key={image.id} image={image} product={product} width={120} />
 * ))}
 *
 * // By id, anywhere under <ShopkitProvider> (fetches; needs <Suspense>):
 * <ProductImage productId="prod_27" width={64} height={64} />
 * ```
 *
 * Renders a single `<img>`; every `<img>` attribute passes through. For a
 * different element (`next/image`, a CSS background) use
 * {@link useProductImage}.
 */
export function ProductImage({
	productId,
	slug,
	product,
	image,
	index,
	imageId,
	includePending,
	width,
	height,
	densities,
	widths,
	transform,
	alt,
	cacheBust,
	fallback = null,
	priority = false,
	loading,
	decoding,
	fetchPriority,
	...imgProps
}: ProductImageProps): ReactNode {
	const options: ProductImageOptions = {
		productId,
		slug,
		product,
		image,
		index,
		imageId,
		includePending,
		width,
		height,
		densities,
		widths,
		transform,
		alt,
		cacheBust,
	};

	const state = useProductImage(options);

	if (!state.src) return fallback;

	return (
		<img
			{...imgProps}
			src={state.src}
			{...(state.srcSet && { srcSet: state.srcSet })}
			alt={state.alt}
			width={state.width}
			height={state.height}
			loading={loading ?? (priority ? "eager" : "lazy")}
			decoding={decoding ?? "async"}
			fetchPriority={fetchPriority ?? (priority ? "high" : undefined)}
		/>
	);
}

/**
 * The product an image should come from: an explicit one, the surrounding
 * `<ProductProvider>`, or a lookup. No hook may follow the conditional `use()`.
 */
function useImageProduct(options: ProductImageOptions): {
	product: Product | null;
	imageBaseUrl: string | null;
} {
	// Both read unconditionally, and both optional: an `<img>` for an image
	// record you already hold needs neither a provider nor a client.
	const productState = useOptionalProductState();
	const shopkit = useContext(ShopkitContext);
	const imageBaseUrl = shopkit?.client.imageBaseUrl ?? null;

	if (options.product) return { product: options.product, imageBaseUrl };

	const contextProduct = productState?.product ?? null;
	// An explicit id that happens to name the surrounding product is not a
	// reason to re-fetch it — a card inside a quick-view does this.
	if (contextProduct && namesProduct(contextProduct, options)) {
		return { product: contextProduct, imageBaseUrl };
	}

	const wantsLookup =
		options.productId !== undefined || options.slug !== undefined;
	if (!wantsLookup) {
		// An explicit image record carries everything needed to render; the
		// product is only used for a fallback alt.
		if (contextProduct || options.image) {
			return { product: contextProduct, imageBaseUrl };
		}
		throw new ShopkitConfigError(
			"shopkit: <ProductImage> needs a `productId`, a `slug`, a `product` or " +
				"an `image` — or a <ProductProvider> above it to take the product from.",
		);
	}

	if (!shopkit) {
		throw new ShopkitConfigError(
			"shopkit: <ProductImage> was given a `productId`/`slug` but there is no " +
				"<ShopkitProvider> above it to fetch with. Pass the `product` (or its " +
				"`image`) you already loaded instead.",
		);
	}

	// biome-ignore lint/correctness/useHookAtTopLevel: `use()` is permitted in conditionals, unlike every other hook.
	const product = usePromise(lookupPromise(shopkit.client, options));
	return { product, imageBaseUrl };
}

/** True when `productId`/`slug` name the product we already have in hand. */
function namesProduct(product: Product, options: ProductImageOptions): boolean {
	if (options.slug !== undefined) {
		const slug = product.slug?.trim().toLowerCase();
		return slug !== undefined && slug === options.slug.trim().toLowerCase();
	}
	if (options.productId !== undefined) {
		return sameProductId(product.id, options.productId);
	}
	// Neither given: the surrounding product is the one meant.
	return true;
}

/**
 * Product ids compare across their two forms: the API returns `"prod_27"` and
 * an app may well hold the raw `27` it took out of a URL.
 */
function sameProductId(a: string, b: string | number): boolean {
	const left = String(a);
	const right = String(b);
	return left === right || rawProductId(left) === rawProductId(right);
}

function rawProductId(id: string): string {
	return id.replace(/^prod_/, "");
}

function lookupPromise(
	client: ShopkitClient,
	options: ProductImageOptions,
): Promise<Product | null> {
	return getProductPromise(
		client,
		options.slug !== undefined
			? { slug: options.slug }
			: { id: options.productId as string | number },
	);
}

/**
 * Everything after the product is known: choose the image, build the URLs.
 * A plain function, not a `useMemo`, because it runs after the conditional
 * `use()` (see `useImageProduct`).
 */
function resolveImageState(
	product: Product | null,
	options: ProductImageOptions,
	fallbackBaseUrl: string | null,
): ProductImageState {
	const image =
		options.image ??
		pickProductImage(product, {
			index: options.index,
			imageId: options.imageId,
			includePending: options.includePending,
		});

	// Top-level `width`/`height` win over `transform`, but only when given:
	// spreading `width: undefined` would drop `transform={{ width: 300 }}`.
	const width = options.width ?? options.transform?.width;
	const height = options.height ?? options.transform?.height;

	const urlOptions = {
		...options.transform,
		width,
		height,
		cacheBust: options.cacheBust,
		baseUrl: fallbackBaseUrl,
	};

	const src = resolveProductImageUrl(image, urlOptions);
	const srcSet = src
		? buildImageSrcSet(image, {
				...urlOptions,
				widths: options.widths,
				densities: options.densities,
			})
		: null;

	return {
		product,
		image,
		src,
		srcSet,
		alt: options.alt ?? image?.altText ?? product?.name ?? "",
		width,
		height,
	};
}
