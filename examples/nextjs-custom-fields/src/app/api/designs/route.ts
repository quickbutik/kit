import { saveDesign, type DesignMeta } from "@/lib/design-store"
import { designPageUrl, designPreviewPath } from "@/lib/design-links"

const MAX_BYTES = 40 * 1024 * 1024

export async function POST(request: Request) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: "Expected multipart form data" }, { status: 400 })
  }

  const print = form.get("print")
  const preview = form.get("preview")
  const rawMeta = form.get("meta")
  if (!(print instanceof Blob) || !(preview instanceof Blob) || typeof rawMeta !== "string") {
    return Response.json({ error: "print, preview and meta are required" }, { status: 400 })
  }
  if (print.type !== "image/png" || print.size > MAX_BYTES || preview.size > MAX_BYTES) {
    return Response.json({ error: "Design file is too large or not a PNG" }, { status: 413 })
  }

  let meta: Omit<DesignMeta, "id" | "createdAt">
  try {
    const m = JSON.parse(rawMeta)
    meta = {
      productId: String(m.productId).slice(0, 40),
      productName: String(m.productName).slice(0, 120),
      variantId: Number(m.variantId),
      variantLabel: String(m.variantLabel).slice(0, 60),
      widthMm: Number(m.widthMm),
      heightMm: Number(m.heightMm),
      shape: m.shape === "circle" ? "circle" : "rect",
      printWidthPx: Number(m.printWidthPx),
      printHeightPx: Number(m.printHeightPx),
      dpi: Number(m.dpi),
      layers: Number(m.layers),
    }
  } catch {
    return Response.json({ error: "Invalid meta" }, { status: 400 })
  }

  const saved = await saveDesign({ meta, print, preview })
  return Response.json(
    { id: saved.id, url: designPageUrl(saved.id), previewUrl: designPreviewPath(saved.id) },
    { status: 201 },
  )
}
