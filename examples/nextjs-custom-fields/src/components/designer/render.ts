import {
  fontString,
  layerSize,
  textLineHeight,
  textMetrics,
  type Layer,
  type Scene,
  type SignSpec,
} from "./scene"

export type ImageCache = Map<string, HTMLImageElement>

/* ------------------------------------------------------------------ shapes */

export function signPath(ctx: CanvasRenderingContext2D, sign: SignSpec, inset = 0) {
  const w = sign.widthMm - inset * 2
  const h = sign.heightMm - inset * 2
  ctx.beginPath()
  if (sign.shape === "circle") {
    ctx.ellipse(sign.widthMm / 2, sign.heightMm / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  } else {
    const r = Math.max(0, Math.min(sign.radiusMm - inset, w / 2, h / 2))
    ctx.roundRect(inset, inset, w, h, r)
  }
  ctx.closePath()
}

/* --------------------------------------------------------------- materials */

const patterns = new Map<string, HTMLCanvasElement>()

function woodTexture(): HTMLCanvasElement {
  const hit = patterns.get("wood")
  if (hit) return hit
  const c = document.createElement("canvas")
  c.width = 1024
  c.height = 256
  const g = c.getContext("2d")!
  g.fillStyle = "#e3c39d"
  g.fillRect(0, 0, c.width, c.height)
  // Long horizontal grain: layered sine bands with a little noise.
  for (let y = 0; y < c.height; y += 1) {
    const band =
      Math.sin(y * 0.09) * 0.5 + Math.sin(y * 0.023 + 1.3) * 0.35 + Math.sin(y * 0.31) * 0.15
    const alpha = 0.05 + Math.max(0, band) * 0.12
    g.fillStyle = `rgba(140, 92, 50, ${alpha})`
    g.fillRect(0, y, c.width, 1)
  }
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * c.height
    g.strokeStyle = `rgba(120, 76, 40, ${0.08 + Math.random() * 0.12})`
    g.lineWidth = 0.5 + Math.random() * 1.2
    g.beginPath()
    g.moveTo(0, y)
    for (let x = 0; x <= c.width; x += 32) {
      g.lineTo(x, y + Math.sin(x * 0.006 + i) * 3 + Math.sin(x * 0.02 + i * 2) * 1.2)
    }
    g.stroke()
  }
  patterns.set("wood", c)
  return c
}

function brushedTexture(): HTMLCanvasElement {
  const hit = patterns.get("brushed")
  if (hit) return hit
  const c = document.createElement("canvas")
  c.width = 512
  c.height = 512
  const g = c.getContext("2d")!
  g.fillStyle = "#dfe3e7"
  g.fillRect(0, 0, c.width, c.height)
  for (let y = 0; y < c.height; y++) {
    const v = Math.random()
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.35})` : `rgba(90,100,110,${(0.5 - v) * 0.12})`
    g.fillRect(0, y, c.width, 1)
  }
  patterns.set("brushed", c)
  return c
}

/** The bare substrate, before any print. */
function drawSubstrate(ctx: CanvasRenderingContext2D, sign: SignSpec, environment = false) {
  const { widthMm: w, heightMm: h } = sign
  switch (sign.material) {
    case "wood": {
      const pattern = ctx.createPattern(woodTexture(), "repeat")!
      pattern.setTransform(new DOMMatrix().scale(0.6))
      ctx.fillStyle = pattern
      break
    }
    case "plate":
    case "aluminium":
    case "round": {
      const pattern = ctx.createPattern(brushedTexture(), "repeat")!
      pattern.setTransform(new DOMMatrix().scale(0.5))
      ctx.fillStyle = pattern
      break
    }
    case "acrylic":
      ctx.fillStyle = environment ? "rgba(225, 240, 246, 0.12)" : "rgba(225, 240, 246, 0.9)"
      break
    default:
      ctx.fillStyle = "#fbfbf8"
  }
  ctx.fillRect(0, 0, w, h)
}

/** Light, depth and edges laid over the print, so it reads as an object. */
function drawFinish(ctx: CanvasRenderingContext2D, sign: SignSpec) {
  const { widthMm: w, heightMm: h } = sign
  if (sign.material === "acrylic") {
    const g = ctx.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, "rgba(255,255,255,0.45)")
    g.addColorStop(0.28, "rgba(255,255,255,0.08)")
    g.addColorStop(0.5, "rgba(255,255,255,0)")
    g.addColorStop(0.78, "rgba(255,255,255,0.06)")
    g.addColorStop(1, "rgba(255,255,255,0.25)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  } else if (sign.material === "aluminium" || sign.material === "round" || sign.material === "plate") {
    const g = ctx.createLinearGradient(0, 0, w * 0.6, h)
    g.addColorStop(0, "rgba(255,255,255,0.18)")
    g.addColorStop(0.5, "rgba(255,255,255,0)")
    g.addColorStop(1, "rgba(0,0,0,0.05)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  } else if (sign.material === "wood") {
    // Ink on wood soaks in slightly: a whisper of grain over the print.
    ctx.globalAlpha = 0.12
    ctx.globalCompositeOperation = "multiply"
    const pattern = ctx.createPattern(woodTexture(), "repeat")!
    pattern.setTransform(new DOMMatrix().scale(0.6))
    ctx.fillStyle = pattern
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = "source-over"
    ctx.globalAlpha = 1
  }
}

/** Positions of the mounting hardware, in mm. */
export function mountingPoints(sign: SignSpec): { x: number; y: number; r: number }[] {
  const { widthMm: w, heightMm: h } = sign
  if (sign.mounting === "eyelets") {
    const pts: { x: number; y: number; r: number }[] = []
    const inset = 15
    const nx = Math.max(1, Math.round((w - inset * 2) / 500))
    const ny = Math.max(1, Math.round((h - inset * 2) / 500))
    for (let i = 0; i <= nx; i++) {
      const x = inset + ((w - inset * 2) * i) / nx
      pts.push({ x, y: inset, r: 6 }, { x, y: h - inset, r: 6 })
    }
    for (let j = 1; j < ny; j++) {
      const y = inset + ((h - inset * 2) * j) / ny
      pts.push({ x: inset, y, r: 6 }, { x: w - inset, y, r: 6 })
    }
    return pts
  }
  if (sign.mounting === "holes" || sign.mounting === "standoffs") {
    const r = sign.mounting === "standoffs" ? Math.min(6, w * 0.022) : Math.min(2.5, w * 0.01)
    if (sign.shape === "circle") {
      return [
        { x: w / 2, y: h * 0.07, r },
        { x: w / 2, y: h * 0.93, r },
      ]
    }
    const inset = sign.mounting === "standoffs" ? Math.min(25, w * 0.08) : Math.min(12, w * 0.05)
    return [
      { x: inset, y: inset, r },
      { x: w - inset, y: inset, r },
      { x: inset, y: h - inset, r },
      { x: w - inset, y: h - inset, r },
    ]
  }
  return []
}

function drawMounting(ctx: CanvasRenderingContext2D, sign: SignSpec) {
  for (const p of mountingPoints(sign)) {
    if (sign.mounting === "standoffs") {
      const g = ctx.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.1, p.x, p.y, p.r)
      g.addColorStop(0, "#fafafa")
      g.addColorStop(0.6, "#b9bec4")
      g.addColorStop(1, "#7d838a")
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fill()
    } else if (sign.mounting === "eyelets") {
      ctx.lineWidth = p.r * 0.45
      ctx.strokeStyle = "#a6abb1"
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r * 0.75, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = "rgba(30,30,35,0.55)"
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r * 0.5, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = "rgba(25,25,30,0.55)"
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/* ------------------------------------------------------------------ layers */

export function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, images: ImageCache) {
  ctx.save()
  ctx.translate(layer.x, layer.y)
  ctx.rotate(layer.rotation)
  ctx.globalAlpha *= layer.opacity
  if (layer.kind === "image") {
    const img = images.get(layer.src)
    ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1)
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, -layer.w / 2, -layer.h / 2, layer.w, layer.h)
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.06)"
      ctx.fillRect(-layer.w / 2, -layer.h / 2, layer.w, layer.h)
    }
  } else {
    const { h, lines, lineWidths, w } = textMetrics(layer)
    // Canvas text is rasterised at the current pixel size; draw at 100 units and
    // scale down, so small mm sizes still render crisp.
    const ref = 100
    const k = layer.fontSize / ref
    ctx.font = fontString(layer, ref)
    ctx.letterSpacing = `${(layer.letterSpacing * ref) / 100}px`
    ctx.fillStyle = layer.color
    ctx.textBaseline = "middle"
    const lh = textLineHeight(layer)
    lines.forEach((line, i) => {
      const lw = lineWidths[i]
      const x = layer.align === "left" ? -w / 2 : layer.align === "right" ? w / 2 - lw : -lw / 2
      const y = -h / 2 + lh * (i + 0.5)
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(k, k)
      ctx.fillText(line, 0, 0)
      ctx.restore()
    })
  }
  ctx.restore()
}

/* ------------------------------------------------------------- composites */

/**
 * Draws the sign as the shopper sees it. `ctx` must already map 1 unit = 1 mm
 * with the sign's top-left at the origin.
 */
export function drawSign(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  sign: SignSpec,
  images: ImageCache,
  opts: { ghost: boolean; guides: boolean; shadow: boolean; environment?: boolean },
) {
  // Content that hangs off the edge stays faintly visible while editing.
  if (opts.ghost) {
    ctx.save()
    ctx.globalAlpha = 0.16
    for (const layer of scene.layers) drawLayer(ctx, layer, images)
    ctx.restore()
  }

  // Edge thickness and soft shadow.
  if (opts.shadow) {
    ctx.save()
    const depth = Math.max(sign.widthMm, sign.heightMm) * 0.006
    ctx.shadowColor = "rgba(20, 18, 30, 0.22)"
    ctx.shadowBlur = Math.max(sign.widthMm, sign.heightMm) * 0.035
    ctx.shadowOffsetY = Math.max(sign.widthMm, sign.heightMm) * 0.018
    ctx.translate(0, depth)
    signPath(ctx, sign)
    ctx.fillStyle = sign.material === "wood" ? "#b88a5c" : sign.material === "acrylic" ? "#bcd9e2" : "#b9bec4"
    ctx.fill()
    ctx.restore()
  }

  ctx.save()
  signPath(ctx, sign)
  ctx.clip()
  drawSubstrate(ctx, sign, opts.environment)
  if (scene.background !== "transparent") {
    ctx.fillStyle = scene.background
    ctx.fillRect(0, 0, sign.widthMm, sign.heightMm)
  }
  for (const layer of scene.layers) drawLayer(ctx, layer, images)
  drawFinish(ctx, sign)
  ctx.restore()

  drawMounting(ctx, sign)

  if (opts.guides && sign.safeMm > 0) {
    ctx.save()
    const px = 1 / ctx.getTransform().a
    ctx.setLineDash([6 * px, 5 * px])
    ctx.lineWidth = 1 * px
    ctx.strokeStyle = "rgba(255, 79, 31, 0.55)"
    signPath(ctx, sign, sign.safeMm)
    ctx.stroke()
    ctx.restore()
  }
}

/** The file the print shop receives: artwork only, at print resolution. */
export function renderPrint(
  scene: Scene,
  sign: SignSpec,
  images: ImageCache,
  size: { width: number; height: number },
): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext("2d")!
  ctx.scale(size.width / sign.widthMm, size.height / sign.heightMm)
  ctx.save()
  signPath(ctx, sign)
  ctx.clip()
  if (scene.background !== "transparent") {
    ctx.fillStyle = scene.background
    ctx.fillRect(0, 0, sign.widthMm, sign.heightMm)
  }
  for (const layer of scene.layers) drawLayer(ctx, layer, images)
  ctx.restore()
  return canvas
}

/** A product-shot style thumbnail for the cart and the order. */
export function renderPreview(scene: Scene, sign: SignSpec, images: ImageCache, longest = 900): HTMLCanvasElement {
  const pad = Math.max(sign.widthMm, sign.heightMm) * 0.06
  const k = longest / (Math.max(sign.widthMm, sign.heightMm) + pad * 2)
  const canvas = document.createElement("canvas")
  canvas.width = Math.round((sign.widthMm + pad * 2) * k)
  canvas.height = Math.round((sign.heightMm + pad * 2) * k)
  const ctx = canvas.getContext("2d")!
  ctx.scale(k, k)
  ctx.translate(pad, pad * 0.7)
  drawSign(ctx, scene, sign, images, { ghost: false, guides: false, shadow: true })
  return canvas
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not render the design"))), type, quality),
  )
}

export { layerSize }
