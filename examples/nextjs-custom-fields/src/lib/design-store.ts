import "server-only"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

/**
 * Where finished designs live. A local folder is enough for development and a
 * single server; on serverless hosting swap these three functions for object
 * storage (S3, R2, Vercel Blob) — the rest of the app only sees ids and URLs.
 */
const ROOT = process.env.DESIGNS_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "designs")

/** Runtime data, not source: keep the bundler from tracing it. */
function designPath(...parts: string[]) {
  return path.join(/* turbopackIgnore: true */ ROOT, ...parts)
}

export type DesignMeta = {
  id: string
  createdAt: string
  productId: string
  productName: string
  variantId: number
  variantLabel: string
  widthMm: number
  heightMm: number
  shape: "rect" | "circle"
  printWidthPx: number
  printHeightPx: number
  dpi: number
  layers: number
}

export const DESIGN_FILES = {
  print: { name: "print.png", type: "image/png" },
  preview: { name: "preview.webp", type: "image/webp" },
} as const

export type DesignFile = keyof typeof DESIGN_FILES

const ID_PATTERN = /^[a-f0-9-]{36}$/

export function isDesignId(id: string): boolean {
  return ID_PATTERN.test(id)
}

export async function saveDesign(input: {
  meta: Omit<DesignMeta, "id" | "createdAt">
  print: Blob
  preview: Blob
}): Promise<DesignMeta> {
  const id = randomUUID()
  await mkdir(designPath(id), { recursive: true })
  const meta: DesignMeta = { ...input.meta, id, createdAt: new Date().toISOString() }
  await Promise.all([
    writeFile(designPath(id, DESIGN_FILES.print.name), Buffer.from(await input.print.arrayBuffer())),
    writeFile(designPath(id, DESIGN_FILES.preview.name), Buffer.from(await input.preview.arrayBuffer())),
    writeFile(designPath(id, "meta.json"), JSON.stringify(meta, null, 2)),
  ])
  return meta
}

export async function readDesignMeta(id: string): Promise<DesignMeta | null> {
  if (!isDesignId(id)) return null
  try {
    return JSON.parse(await readFile(designPath(id, "meta.json"), "utf8")) as DesignMeta
  } catch {
    return null
  }
}

export async function readDesignFile(id: string, file: DesignFile): Promise<Buffer | null> {
  if (!isDesignId(id)) return null
  try {
    return await readFile(designPath(id, DESIGN_FILES[file].name))
  } catch {
    return null
  }
}
