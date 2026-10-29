import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { designPreviewPath, designPrintPath } from "@/lib/design-links"
import { readDesignMeta } from "@/lib/design-store"

export const metadata: Metadata = { title: "Print file", robots: { index: false, follow: false } }

/** What the merchant opens from the order's custom product field. */
export default function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="design-sheet">
      <Suspense fallback={<p>Loading design…</p>}>
        <Sheet params={params} />
      </Suspense>
    </main>
  )
}

async function Sheet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const meta = await readDesignMeta(id)
  if (!meta) notFound()
  return (
    <>
      <div className="design-sheet-art">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={designPreviewPath(id)} alt="Design preview" />
      </div>
      <div className="design-sheet-info">
        <p className="eyebrow">Print file</p>
        <h1>
          {meta.productName} · {meta.variantLabel}
        </h1>
        <dl>
          <div>
            <dt>Physical size</dt>
            <dd>
              {meta.shape === "circle" ? `Ø ${meta.widthMm / 10} cm` : `${meta.widthMm / 10} × ${meta.heightMm / 10} cm`}
            </dd>
          </div>
          <div>
            <dt>Print file</dt>
            <dd>
              {meta.printWidthPx} × {meta.printHeightPx} px · {meta.dpi} DPI · PNG
            </dd>
          </div>
          <div>
            <dt>Layers</dt>
            <dd>{meta.layers}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{new Date(meta.createdAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</dd>
          </div>
          <div>
            <dt>Design id</dt>
            <dd className="mono">{meta.id}</dd>
          </div>
        </dl>
        <a className="btn btn-primary btn-lg" href={designPrintPath(id)} download>
          Download print file
        </a>
      </div>
    </>
  )
}
