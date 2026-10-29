/**
 * The design model. Every coordinate is in millimetres on the physical sign,
 * origin top-left, so a design survives a size change and exports at any DPI.
 * Positions are layer CENTRES; rotation is in radians.
 */

export type ImageLayer = {
  kind: "image"
  id: string
  name: string
  src: string
  x: number
  y: number
  w: number
  h: number
  rotation: number
  flipX: boolean
  flipY: boolean
  opacity: number
}

export type TextLayer = {
  kind: "text"
  id: string
  name: string
  text: string
  x: number
  y: number
  fontSize: number
  fontFamily: string
  fontWeight: number
  italic: boolean
  color: string
  align: "left" | "center" | "right"
  letterSpacing: number
  rotation: number
  opacity: number
}

export type Layer = ImageLayer | TextLayer

export type Scene = {
  background: string
  layers: Layer[]
}

export type SignSpec = {
  widthMm: number
  heightMm: number
  shape: "rect" | "circle"
  radiusMm: number
  safeMm: number
  material: "aluminium" | "acrylic" | "wood" | "banner" | "plate" | "round"
  mounting: "holes" | "standoffs" | "eyelets" | "none"
}

export const FONTS = [
  { family: "var(--font-display)", label: "Bricolage", css: "Bricolage Grotesque" },
  { family: "var(--font-body)", label: "Instrument", css: "Instrument Sans" },
  { family: "var(--font-serif)", label: "Fraunces", css: "Fraunces" },
  { family: "var(--font-mono)", label: "Mono", css: "JetBrains Mono" },
  { family: "var(--font-script)", label: "Caveat", css: "Caveat" },
] as const

let counter = 0
export function newId(): string {
  counter += 1
  return `${Date.now().toString(36)}-${counter}`
}

const LINE_HEIGHT = 1.12

let measureCtx: CanvasRenderingContext2D | null = null
function measurer(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d")!
  return measureCtx
}

/** Canvas font strings need a concrete family, not a CSS variable. */
const resolvedFonts = new Map<string, string>()
export function resolveFontFamily(family: string): string {
  const cached = resolvedFonts.get(family)
  if (cached) return cached
  let value = family
  const variable = /^var\((--[^)]+)\)$/.exec(family)
  if (variable && typeof document !== "undefined") {
    value = getComputedStyle(document.documentElement).getPropertyValue(variable[1]).trim() || "sans-serif"
  }
  resolvedFonts.set(family, value)
  return value
}

export function fontString(layer: TextLayer, sizePx: number): string {
  return `${layer.italic ? "italic " : ""}${layer.fontWeight} ${sizePx}px ${resolveFontFamily(layer.fontFamily)}`
}

/** Box of a text layer in mm, measured at a fixed size and scaled. */
export function textMetrics(layer: TextLayer): { w: number; h: number; lines: string[]; lineWidths: number[] } {
  const ctx = measurer()
  const ref = 100
  ctx.font = fontString(layer, ref)
  ctx.letterSpacing = `${(layer.letterSpacing * ref) / 100}px`
  const lines = layer.text.split("\n")
  const lineWidths = lines.map((l) => (ctx.measureText(l || " ").width / ref) * layer.fontSize)
  const w = Math.max(...lineWidths, layer.fontSize * 0.3)
  const h = lines.length * layer.fontSize * LINE_HEIGHT
  return { w, h, lines, lineWidths }
}

export function layerSize(layer: Layer): { w: number; h: number } {
  if (layer.kind === "image") return { w: layer.w, h: layer.h }
  const { w, h } = textMetrics(layer)
  return { w, h }
}

export function textLineHeight(layer: TextLayer): number {
  return layer.fontSize * LINE_HEIGHT
}

/** A point in sign space expressed in the layer's own unrotated frame. */
export function toLocal(layer: Layer, px: number, py: number): { x: number; y: number } {
  const dx = px - layer.x
  const dy = py - layer.y
  const c = Math.cos(-layer.rotation)
  const s = Math.sin(-layer.rotation)
  return { x: dx * c - dy * s, y: dx * s + dy * c }
}

export function toWorld(layer: Layer, lx: number, ly: number): { x: number; y: number } {
  const c = Math.cos(layer.rotation)
  const s = Math.sin(layer.rotation)
  return { x: layer.x + lx * c - ly * s, y: layer.y + lx * s + ly * c }
}

export function hitLayer(layers: Layer[], x: number, y: number, slackMm: number): Layer | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    const { w, h } = layerSize(layer)
    const p = toLocal(layer, x, y)
    if (Math.abs(p.x) <= w / 2 + slackMm && Math.abs(p.y) <= h / 2 + slackMm) return layer
  }
  return null
}

/** Effective print resolution of an image layer at its current size. */
export function effectiveDpi(layer: ImageLayer, img: HTMLImageElement | undefined): number | null {
  if (!img || !img.naturalWidth) return null
  return Math.round(img.naturalWidth / (layer.w / 25.4))
}

/** How far the sign can be printed per pixel: capped so huge banners stay sane. */
export function printResolution(sign: SignSpec): { dpi: number; width: number; height: number } {
  const MAX_PX = 4800
  const longest = Math.max(sign.widthMm, sign.heightMm) / 25.4
  const dpi = Math.max(30, Math.min(150, Math.floor(MAX_PX / longest)))
  return {
    dpi,
    width: Math.round((sign.widthMm / 25.4) * dpi),
    height: Math.round((sign.heightMm / 25.4) * dpi),
  }
}

/** Scales and re-centres every layer when the shopper picks another size. */
export function rescaleScene(scene: Scene, from: SignSpec, to: SignSpec): Scene {
  const k = Math.min(to.widthMm / from.widthMm, to.heightMm / from.heightMm)
  const ox = (to.widthMm - from.widthMm * k) / 2
  const oy = (to.heightMm - from.heightMm * k) / 2
  return {
    ...scene,
    layers: scene.layers.map((l) =>
      l.kind === "image"
        ? { ...l, x: l.x * k + ox, y: l.y * k + oy, w: l.w * k, h: l.h * k }
        : { ...l, x: l.x * k + ox, y: l.y * k + oy, fontSize: l.fontSize * k },
    ),
  }
}
