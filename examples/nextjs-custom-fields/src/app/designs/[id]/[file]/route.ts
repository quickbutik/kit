import { DESIGN_FILES, readDesignFile, type DesignFile } from "@/lib/design-store"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params
  if (!(file in DESIGN_FILES)) return new Response("Not found", { status: 404 })
  const key = file as DesignFile
  const data = await readDesignFile(id, key)
  if (!data) return new Response("Not found", { status: 404 })

  const headers: Record<string, string> = {
    "Content-Type": DESIGN_FILES[key].type,
    // A design never changes once saved.
    "Cache-Control": "public, max-age=31536000, immutable",
  }
  if (key === "print") headers["Content-Disposition"] = `attachment; filename="design-${id}.png"`
  return new Response(new Uint8Array(data), { headers })
}
