"use client"

import { useEffect, useRef, useState, type DragEvent } from "react"
import { drawSign, type ImageCache } from "./render"
import { hitLayer, layerSize, toWorld, type Layer, type Scene, type SignSpec } from "./scene"

type Props = {
  scene: Scene
  sign: SignSpec
  images: ImageCache
  imagesVersion: number
  selectedId: string | null
  zoom: number
  onSelect: (id: string | null) => void
  /** `commit` marks the end of a gesture: the point an undo step is recorded. */
  onChange: (scene: Scene, commit: boolean) => void
  onZoom: (zoom: number) => void
  onFiles: (files: File[]) => void
  onEditText: (id: string) => void
}


type Gesture =
  | { kind: "move"; id: string; startX: number; startY: number; layerX: number; layerY: number; moved: boolean }
  | {
      kind: "scale"
      id: string
      start: Layer
      /** The corner opposite the grabbed one: it stays put while the layer resizes. */
      anchor: { x: number; y: number }
      /** Anchor → grabbed corner at gesture start; the pointer is projected onto it. */
      diagonal: { x: number; y: number }
    }
  | { kind: "rotate"; id: string; startAngle: number; startRotation: number }
  | { kind: "pan"; startX: number; startY: number; panX: number; panY: number }

type Guide = { axis: "x" | "y"; at: number }

type Handle = { kind: "rotate" } | { kind: "scale"; cx: number; cy: number }

const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const

const HANDLE_PX = 9
const ROTATE_OFFSET_PX = 30
const SNAP_PX = 7

export function Stage(props: Props) {
  const { scene, sign, images, imagesVersion, selectedId, zoom } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  // The scene as the gesture last left it; renders can lag behind pointer events.
  const liveRef = useRef<Scene | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [panState, setPan] = useState({ x: 0, y: 0 })
  // Panning only applies while zoomed in; at fit the sign is always centred.
  const panX = zoom > 1 ? panState.x : 0
  const panY = zoom > 1 ? panState.y : 0
  const [hoverCursor, setHoverCursor] = useState("default")
  const [dragging, setDragging] = useState(false)
  const view = computeView(size, sign, zoom, panX, panY)

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  // Paint.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !size.w || !size.h) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    const ctx = canvas.getContext("2d")!
    const { scale, ox, oy } = computeView(size, sign, zoom, panX, panY)

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy)
    drawSign(ctx, scene, sign, images, { ghost: true, guides: true, shadow: true })

    // Screen-space overlays.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const toScreen = (x: number, y: number) => ({ x: ox + x * scale, y: oy + y * scale })

    for (const g of guides) {
      ctx.strokeStyle = "#ff4f1f"
      ctx.lineWidth = 1
      ctx.setLineDash([])
      ctx.beginPath()
      if (g.axis === "x") {
        const p = toScreen(g.at, 0)
        ctx.moveTo(p.x, oy - 12)
        ctx.lineTo(p.x, oy + sign.heightMm * scale + 12)
      } else {
        const p = toScreen(0, g.at)
        ctx.moveTo(ox - 12, p.y)
        ctx.lineTo(ox + sign.widthMm * scale + 12, p.y)
      }
      ctx.stroke()
    }

    const selected = scene.layers.find((l) => l.id === selectedId)
    if (selected) {
      const { w, h } = layerSize(selected)
      const corners = [
        toWorld(selected, -w / 2, -h / 2),
        toWorld(selected, w / 2, -h / 2),
        toWorld(selected, w / 2, h / 2),
        toWorld(selected, -w / 2, h / 2),
      ].map((p) => toScreen(p.x, p.y))
      ctx.strokeStyle = "#ff4f1f"
      ctx.lineWidth = 1.5
      ctx.beginPath()
      corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.closePath()
      ctx.stroke()

      const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 }
      const rot = rotateHandle(selected, scale, toScreen)
      ctx.beginPath()
      ctx.moveTo(topMid.x, topMid.y)
      ctx.lineTo(rot.x, rot.y)
      ctx.stroke()
      ctx.fillStyle = "#ff4f1f"
      ctx.beginPath()
      ctx.arc(rot.x, rot.y, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = "#fff"
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(rot.x, rot.y, 2.6, -Math.PI * 0.9, Math.PI * 0.4)
      ctx.stroke()

      for (const p of corners) {
        ctx.fillStyle = "#fff"
        ctx.strokeStyle = "#ff4f1f"
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.roundRect(p.x - HANDLE_PX / 2 - 1, p.y - HANDLE_PX / 2 - 1, HANDLE_PX + 2, HANDLE_PX + 2, 3)
        ctx.fill()
        ctx.stroke()
      }
    }
  }, [scene, sign, images, imagesVersion, selectedId, zoom, panX, panY, size, guides])

  function toSign(e: { clientX: number; clientY: number }) {
    const rect = canvasRef.current!.getBoundingClientRect()
    const { scale, ox, oy } = view
    return { x: (e.clientX - rect.left - ox) / scale, y: (e.clientY - rect.top - oy) / scale }
  }

  function screenOf(x: number, y: number) {
    const { scale, ox, oy } = view
    return { x: ox + x * scale, y: oy + y * scale }
  }

  function handleAt(e: { clientX: number; clientY: number }): Handle | null {
    const selected = scene.layers.find((l) => l.id === selectedId)
    if (!selected) return null
    const rect = canvasRef.current!.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const touchy = window.matchMedia("(pointer: coarse)").matches
    const reach = touchy ? 22 : 12
    const rot = rotateHandle(selected, view.scale, screenOf)
    if (Math.hypot(sx - rot.x, sy - rot.y) <= reach) return { kind: "rotate" }
    const { w, h } = layerSize(selected)
    for (const [cx, cy] of CORNERS) {
      const p = toWorld(selected, (cx * w) / 2, (cy * h) / 2)
      const s = screenOf(p.x, p.y)
      if (Math.hypot(sx - s.x, sy - s.y) <= reach) return { kind: "scale", cx, cy }
    }
    return null
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return
    const canvas = canvasRef.current!
    canvas.setPointerCapture(e.pointerId)
    const p = toSign(e)
    const handle = handleAt(e)
    const selected = scene.layers.find((l) => l.id === selectedId)
    if (handle && selected) {
      if (handle.kind === "rotate") {
        gestureRef.current = {
          kind: "rotate",
          id: selected.id,
          startAngle: Math.atan2(p.y - selected.y, p.x - selected.x),
          startRotation: selected.rotation,
        }
      } else {
        const { w, h } = layerSize(selected)
        const anchor = toWorld(selected, (-handle.cx * w) / 2, (-handle.cy * h) / 2)
        const corner = toWorld(selected, (handle.cx * w) / 2, (handle.cy * h) / 2)
        gestureRef.current = {
          kind: "scale",
          id: selected.id,
          start: selected,
          anchor,
          diagonal: { x: corner.x - anchor.x, y: corner.y - anchor.y },
        }
      }
      return
    }
    const slack = 4 / view.scale
    const hit = hitLayer(scene.layers, p.x, p.y, slack)
    if (hit) {
      props.onSelect(hit.id)
      gestureRef.current = {
        kind: "move",
        id: hit.id,
        startX: p.x,
        startY: p.y,
        layerX: hit.x,
        layerY: hit.y,
        moved: false,
      }
      return
    }
    props.onSelect(null)
    gestureRef.current = { kind: "pan", startX: e.clientX, startY: e.clientY, panX, panY }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const g = gestureRef.current
    if (!g) {
      const handle = handleAt(e)
      const selected = scene.layers.find((l) => l.id === selectedId)
      if (handle?.kind === "rotate") setHoverCursor("grab")
      else if (handle?.kind === "scale" && selected) setHoverCursor(resizeCursor(selected, handle.cx, handle.cy))
      else {
        const p = toSign(e)
        setHoverCursor(hitLayer(scene.layers, p.x, p.y, 4 / view.scale) ? "move" : zoom > 1 ? "grab" : "default")
      }
      return
    }
    if (g.kind === "pan") {
      if (zoom > 1) setPan({ x: g.panX + e.clientX - g.startX, y: g.panY + e.clientY - g.startY })
      return
    }
    const p = toSign(e)
    const current = liveRef.current ?? scene
    const layer = current.layers.find((l) => l.id === g.id)
    if (!layer) return
    let next: Layer = layer

    if (g.kind === "move") {
      let x = g.layerX + (p.x - g.startX)
      let y = g.layerY + (p.y - g.startY)
      const snapped: Guide[] = []
      if (!e.altKey) {
        const tol = SNAP_PX / view.scale
        const { w, h } = layerSize(layer)
        const ext = rotatedExtent(layer, w, h)
        const xs = [sign.widthMm / 2, sign.safeMm, sign.widthMm - sign.safeMm]
        const ys = [sign.heightMm / 2, sign.safeMm, sign.heightMm - sign.safeMm]
        const sx = snap1(x, ext.w / 2, xs, tol)
        const sy = snap1(y, ext.h / 2, ys, tol)
        if (sx) {
          x = sx.value
          snapped.push({ axis: "x", at: sx.line })
        }
        if (sy) {
          y = sy.value
          snapped.push({ axis: "y", at: sy.line })
        }
      }
      setGuides(snapped)
      g.moved = true
      next = { ...layer, x, y }
    } else if (g.kind === "scale") {
      // Proportional: project the pointer onto the original diagonal, so the
      // grabbed corner follows the pointer and the opposite corner stays fixed.
      const { anchor, diagonal: d } = g
      const along = ((p.x - anchor.x) * d.x + (p.y - anchor.y) * d.y) / (d.x * d.x + d.y * d.y || 1)
      const { w: w0, h: h0 } = layerSize(g.start)
      const minK = 2 / Math.min(w0, h0)
      const k = Math.max(minK, along)
      const center = { x: anchor.x + (d.x * k) / 2, y: anchor.y + (d.y * k) / 2 }
      next =
        g.start.kind === "image"
          ? { ...(layer as typeof g.start), ...center, w: g.start.w * k, h: g.start.h * k }
          : { ...(layer as typeof g.start), ...center, fontSize: g.start.fontSize * k }
    } else if (g.kind === "rotate") {
      const angle = Math.atan2(p.y - layer.y, p.x - layer.x)
      let rotation = g.startRotation + angle - g.startAngle
      const step = Math.PI / 12
      if (e.shiftKey) rotation = Math.round(rotation / step) * step
      else {
        const quarter = Math.round(rotation / (Math.PI / 2)) * (Math.PI / 2)
        if (Math.abs(rotation - quarter) < 0.05) rotation = quarter
      }
      next = { ...layer, rotation: normalizeAngle(rotation) }
    }

    const updated = { ...current, layers: current.layers.map((l) => (l.id === g.id ? next : l)) }
    liveRef.current = updated
    props.onChange(updated, false)
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const g = gestureRef.current
    const live = liveRef.current
    gestureRef.current = null
    liveRef.current = null
    setGuides([])
    canvasRef.current?.releasePointerCapture(e.pointerId)
    if (!g || g.kind === "pan") return
    if (!live || (g.kind === "move" && !g.moved)) return
    props.onChange(live, true)
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const p = toSign(e)
    const hit = hitLayer(scene.layers, p.x, p.y, 4 / view.scale)
    if (hit?.kind === "text") props.onEditText(hit.id)
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    if (!e.ctrlKey && !e.metaKey) {
      if (zoom > 1) setPan({ x: panX - e.deltaX, y: panY - e.deltaY })
      return
    }
    props.onZoom(clampZoom(zoom * Math.exp(-e.deltaY * 0.01)))
  }

  // Ctrl/⌘ + wheel must not zoom the whole page.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const stop = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || zoom > 1) e.preventDefault()
    }
    canvas.addEventListener("wheel", stop, { passive: false })
    return () => canvas.removeEventListener("wheel", stop)
  }, [zoom])

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"))
    if (files.length) props.onFiles(files)
  }

  const { scale, ox, oy } = view
  const widthLabel = sign.shape === "circle" ? `Ø ${fmtCm(sign.widthMm)}` : fmtCm(sign.widthMm)

  return (
    <div
      ref={wrapRef}
      className="stage"
      data-dragging={dragging || undefined}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        style={{ width: size.w, height: size.h, cursor: hoverCursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        aria-label={`Sign canvas, ${widthLabel} wide`}
        role="img"
      />
      {size.w > 0 && (
        <>
          <div className="dim dim-x" style={{ left: ox, top: oy - 30, width: sign.widthMm * scale }}>
            <span>{widthLabel}</span>
          </div>
          {sign.shape !== "circle" && (
            <div className="dim dim-y" style={{ left: ox - 30, top: oy, height: sign.heightMm * scale }}>
              <span>{fmtCm(sign.heightMm)}</span>
            </div>
          )}
        </>
      )}
      {dragging && <div className="drop-hint">Drop to place on your sign</div>}
    </div>
  )
}

function computeView(
  size: { w: number; h: number },
  sign: SignSpec,
  zoom: number,
  panX: number,
  panY: number,
) {
  const margin = Math.min(72, Math.max(36, Math.min(size.w, size.h) * 0.1))
  const fit = Math.max(
    0.01,
    Math.min((size.w - margin * 2) / sign.widthMm, (size.h - margin * 2) / sign.heightMm),
  )
  const scale = fit * zoom
  return {
    scale,
    ox: (size.w - sign.widthMm * scale) / 2 + panX,
    oy: (size.h - sign.heightMm * scale) / 2 + panY,
  }
}

/** A diagonal resize cursor that follows the layer's rotation. */
function resizeCursor(layer: Layer, cx: number, cy: number) {
  const angle = Math.atan2(cy, cx) + layer.rotation
  const deg = (((angle * 180) / Math.PI) % 180 + 180) % 180
  if (deg < 22.5 || deg >= 157.5) return "ew-resize"
  if (deg < 67.5) return "nwse-resize"
  if (deg < 112.5) return "ns-resize"
  return "nesw-resize"
}

function rotateHandle(layer: Layer, scale: number, toScreen: (x: number, y: number) => { x: number; y: number }) {
  const { h } = layerSize(layer)
  const p = toWorld(layer, 0, -h / 2 - ROTATE_OFFSET_PX / scale)
  return toScreen(p.x, p.y)
}

/** Axis-aligned half extents of a rotated box. */
function rotatedExtent(layer: Layer, w: number, h: number) {
  const c = Math.abs(Math.cos(layer.rotation))
  const s = Math.abs(Math.sin(layer.rotation))
  return { w: w * c + h * s, h: w * s + h * c }
}

/** Snaps a centre so that its centre or either edge lands on a line. */
function snap1(center: number, half: number, lines: number[], tol: number) {
  let best: { value: number; line: number; d: number } | null = null
  for (const line of lines) {
    for (const offset of [0, -half, half]) {
      const d = Math.abs(center + offset - line)
      if (d <= tol && (!best || d < best.d)) best = { value: line - offset, line, d }
    }
  }
  return best
}

function normalizeAngle(a: number) {
  const t = Math.PI * 2
  return ((((a + Math.PI) % t) + t) % t) - Math.PI
}

export function clampZoom(z: number) {
  return Math.min(4, Math.max(0.5, z))
}

function fmtCm(mm: number) {
  const cm = mm / 10
  return `${Number.isInteger(cm) ? cm : cm.toFixed(1)} cm`
}

