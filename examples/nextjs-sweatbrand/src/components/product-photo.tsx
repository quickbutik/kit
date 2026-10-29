"use client";

import type { Product } from "@quickbutik/kit";
import { ProductImage } from "@quickbutik/kit/react";

// Product images come from the Quickbutik CDN, which resizes them per width.
const widths = [240, 360, 480, 640, 800, 1000, 1200, 1600];

export default function ProductPhoto({
  product,
  imageId,
  sizes = "(max-width: 640px) 50vw, (max-width: 1000px) 33vw, 25vw",
  eager = false,
}: {
  product: Product;
  // A specific image, such as a color's; the main image when omitted.
  imageId?: number;
  sizes?: string;
  eager?: boolean;
}) {
  return (
    <ProductImage
      product={product}
      imageId={imageId}
      widths={widths}
      sizes={sizes}
      priority={eager}
      className="product-image"
    />
  );
}
