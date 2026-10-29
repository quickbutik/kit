"use client"

import type { Product } from "@quickbutik/kit"
import Link from "next/link"
import Image from "next/image"
import { useState } from "react"
import { SAMPLE, sceneFor } from "@/lib/showcase"
import { materialFor, money, sellableVariants, variantLabel, variantSize } from "@/lib/signs"
import { ArrowRightIcon, CheckIcon } from "./icons"
import { SignMock } from "./SignMock"

export function ProductDetail({ product }: { product: Product }) {
  const material = materialFor(product)
  const scene = sceneFor(material.key)
  const [view, setView] = useState<"product" | "scene">("product")
  const variants = sellableVariants(product)
  const [variantId, setVariantId] = useState(variants[0]?.id)
  const variant = variants.find((v) => v.id === variantId) ?? variants[0]
  const size = variantSize(variant)
  const largest = Math.max(...variants.map((v) => Math.max(variantSize(v).widthMm, variantSize(v).heightMm)))
  // The illustration grows with the chosen size, so the step between sizes is felt.
  const scale = 0.55 + 0.45 * (Math.max(size.widthMm, size.heightMm) / largest)

  return (
    <div className="product-layout">
      <div className="product-gallery">
        <div
          id="product-preview"
          className="product-stage"
          data-scene={view === "scene" || undefined}
          style={{ "--material-accent": material.accent } as React.CSSProperties}
        >
          {view === "scene" && scene ? (
            <Image
              src={scene.image}
              alt={scene.alt}
              fill
              sizes="(max-width: 860px) calc(100vw - 32px), (max-width: 1240px) 52vw, 608px"
            />
          ) : (
            <>
              <div className="product-stage-art" style={{ transform: `scale(${scale})` }}>
                <SignMock material={material} ratio={size.widthMm / size.heightMm} {...SAMPLE[material.key]} />
              </div>
              <span className="product-stage-dim">{size.label}</span>
            </>
          )}
        </div>
        {scene && (
          <>
            <div className="gallery-controls" role="group" aria-label="Sign preview">
              <button type="button" aria-pressed={view === "product"} aria-controls="product-preview" onClick={() => setView("product")}>
                Product view
              </button>
              <button type="button" aria-pressed={view === "scene"} aria-controls="product-preview" onClick={() => setView("scene")}>
                In a setting
              </button>
            </div>
            <p className="gallery-caption" aria-live="polite">
              {view === "scene" ? `${scene.setting} · Illustrative mockup with example artwork, not a size preview.` : "Example artwork. Choose a size, then make it yours in the designer."}
            </p>
          </>
        )}
      </div>

      <div className="product-info">
        <Link href="/#signs" className="crumb">
          ← All signs
        </Link>
        <p className="eyebrow">{material.label}</p>
        <h1>{product.name}</h1>
        {product.description && (
          <div className="prose" dangerouslySetInnerHTML={{ __html: product.description }} />
        )}

        <fieldset className="size-picker">
          <legend>Size</legend>
          {variants.map((v) => {
            const s = variantSize(v)
            return (
              <label key={v.id} className="size-option" data-checked={v.id === variant.id || undefined}>
                <input
                  type="radio"
                  name="size"
                  value={v.id}
                  checked={v.id === variant.id}
                  onChange={() => setVariantId(v.id)}
                />
                <span
                  className="size-glyph"
                  data-round={material.shape === "circle" || undefined}
                  style={{ aspectRatio: `${s.widthMm} / ${s.heightMm}` }}
                  aria-hidden="true"
                />
                <span className="size-label">{variantLabel(v)}</span>
                <span className="size-price">{money(v.price.price)}</span>
              </label>
            )
          })}
        </fieldset>

        <Link href={`/design/${product.slug}?size=${variant.id}`} className="btn btn-primary btn-lg btn-block">
          Start designing · {money(variant.price.price)} <ArrowRightIcon />
        </Link>

        <ul className="perks">
          <li>
            <CheckIcon width={16} height={16} /> Upload any image and place it freely
          </li>
          <li>
            <CheckIcon width={16} height={16} /> True-to-scale canvas with safe-zone guides
          </li>
          <li>
            <CheckIcon width={16} height={16} /> Printed and shipped in 3–5 working days
          </li>
        </ul>
      </div>
    </div>
  )
}
