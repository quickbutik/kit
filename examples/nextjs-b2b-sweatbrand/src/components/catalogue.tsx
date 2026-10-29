"use client"

import type { Product } from "@quickbutik/kit"
import { useState } from "react"
import { styleNumber } from "@/lib/matrix"
import { matches, searchText } from "@/lib/search"
import { CatalogIntro } from "./catalog-intro"
import { CatalogSearch } from "./catalog-search"
import { ProductSheet } from "./product-sheet"

/**
 * The catalogue with live search. Styles that don't match are hidden, not
 * unmounted, so a grid you're halfway through keeps its unsaved cells.
 * Catalogue numbers stay fixed, like page numbers in a printed catalogue.
 */
export function Catalogue({ products }: { products: Product[] }) {
  const [query, setQuery] = useState("")
  const [haystacks] = useState(() => new Map(products.map((p) => [p.id, searchText(p)])))

  const visible = new Set(products.filter((p) => matches(haystacks.get(p.id) ?? "", query)).map((p) => p.id))

  return (
    <div className="catalogue">
      <aside className="index" aria-label="Index of styles">
        <p className="index__title">Index</p>
        <ol className="index__list">
          {products.map((product, i) => (
            <li key={product.id} hidden={!visible.has(product.id)}>
              <a href={`#${product.slug ?? product.id}`}>
                <span className="index__no">{String(i + 1).padStart(2, "0")}</span>
                <span className="index__name">{product.name}</span>
                <span className="index__style">{styleNumber(product)}</span>
              </a>
            </li>
          ))}
        </ol>
      </aside>

      <div className="catalogue__sheets">
        <CatalogIntro styles={products.length}>
          <CatalogSearch onQuery={setQuery} shown={visible.size} total={products.length} />
        </CatalogIntro>

        {products.map((product, i) => (
          <div key={product.id} className="sheet-slot" hidden={!visible.has(product.id)}>
            <ProductSheet product={product} index={i} />
          </div>
        ))}

        {visible.size === 0 && (
          <div className="empty search-empty">
            <p>No styles match &ldquo;{query.trim()}&rdquo;.</p>
            <p>Try a style name, a style number like SW-04, a SKU or a colour.</p>
          </div>
        )}
      </div>
    </div>
  )
}
