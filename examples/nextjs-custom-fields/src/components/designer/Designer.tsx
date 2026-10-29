"use client"

import type { Product } from "@quickbutik/kit"
import { useShopkitContext } from "@quickbutik/kit/react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  AlertIcon,
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowLeftIcon,
  BagIcon,
  CenterIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DownIcon,
  FitIcon,
  FlipHIcon,
  FlipVIcon,
  ImageIcon,
  LayersIcon,
  MinusIcon,
  PaletteIcon,
  PlusIcon,
  RedoIcon,
  TextIcon,
  TrashIcon,
  UndoIcon,
  UpIcon,
  UploadIcon,
} from "@/components/icons"
import { designField, designPageUrl } from "@/lib/design-links"
import { materialFor, money, sellableVariants, variantLabel, variantSize, type Material } from "@/lib/signs"
import { canvasToBlob, renderPreview, renderPrint, type ImageCache } from "./render"
import {
  FONTS,
  effectiveDpi,
  layerSize,
  newId,
  printResolution,
  rescaleScene,
  resolveFontFamily,
  type ImageLayer,
  type Layer,
  type Scene,
  type SignSpec,
  type TextLayer,
} from "./scene"
import { Stage, clampZoom } from "./Stage"
import { ScenePreview } from "./ScenePreview"
import { PREVIEW_SETTINGS, defaultPreviewSetting, type PreviewSettingId } from "./preview-settings"

type Tab = "upload" | "text" | "background" | "layers"
type Upload = { src: string; name: string; width: number; height: number }
type SaveState =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "done"; previewUrl: string }
  | { kind: "error"; message: string }

const SWATCHES = [
  "#ffffff",
  "#f4efe6",
  "#16161a",
  "#ff4f1f",
  "#ffc53d",
  "#2fbf71",
  "#1f6feb",
  "#7c5cff",
  "#ff7eb6",
  "#0b3d2e",
]

const MIN_DPI = 72

function signFrom(material: Material, size: { widthMm: number; heightMm: number }): SignSpec {
  return {
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    shape: material.shape,
    radiusMm: material.radiusMm,
    safeMm: Math.min(material.safeMm, Math.min(size.widthMm, size.heightMm) * 0.12),
    material: material.key,
    mounting: material.mounting,
  }
}

export function Designer({ product }: { product: Product }) {
  const router = useRouter()
  const params = useSearchParams()
  const { client, cartStore } = useShopkitContext()
  const material = materialFor(product)
  const variants = sellableVariants(product)
  const initialVariant = variants.find((v) => String(v.id) === params.get("size")) ?? variants[0]

  const [variantId, setVariantId] = useState(initialVariant?.id)
  const variant = variants.find((v) => v.id === variantId) ?? variants[0]
  const sign = signFrom(material, variantSize(variant))

  const [scene, setScene] = useState<Scene>({ background: material.background, layers: [] })
  const [past, setPast] = useState<Scene[]>([])
  const [future, setFuture] = useState<Scene[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [tab, setTab] = useState<Tab>("upload")
  const [sheetOpen, setSheetOpen] = useState(false)
  const [preview, setPreview] = useState(false)
  const [previewSettingId, setPreviewSettingId] = useState<PreviewSettingId>(() => defaultPreviewSetting(material.key))
  const [images] = useState<ImageCache>(() => new Map())
  const [imagesVersion, setImagesVersion] = useState(0)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [save, setSave] = useState<SaveState>({ kind: "idle" })
  const committed = useRef<Scene>(scene)
  const fileInput = useRef<HTMLInputElement>(null)
  const textInput = useRef<HTMLTextAreaElement>(null)
  const designButton = useRef<HTMLButtonElement>(null)

  const selected = scene.layers.find((l) => l.id === selectedId) ?? null
  const dirty = scene.layers.length > 0

  function showDesign() {
    setPreview(false)
    requestAnimationFrame(() => designButton.current?.focus())
  }

  /* ---------------------------------------------------------------- history */

  function commit(next: Scene) {
    setPast((p) => [...p.slice(-60), committed.current])
    setFuture([])
    committed.current = next
    setScene(next)
  }

  function onStageChange(next: Scene, isCommit: boolean) {
    if (isCommit) commit(next)
    else setScene(next)
  }

  function undo() {
    const prev = past.at(-1)
    if (!prev) return
    setPast((p) => p.slice(0, -1))
    setFuture((f) => [committed.current, ...f])
    committed.current = prev
    setScene(prev)
    if (selectedId && !prev.layers.some((l) => l.id === selectedId)) setSelectedId(null)
  }

  function redo() {
    const next = future[0]
    if (!next) return
    setFuture((f) => f.slice(1))
    setPast((p) => [...p, committed.current])
    committed.current = next
    setScene(next)
  }

  function updateLayer(id: string, patch: Partial<ImageLayer> | Partial<TextLayer>) {
    commit({
      ...scene,
      layers: scene.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
    })
  }

  /* ----------------------------------------------------------------- layers */

  function addImageLayer(upload: Upload) {
    const box = {
      w: (sign.widthMm - sign.safeMm * 2) * 0.7,
      h: (sign.heightMm - sign.safeMm * 2) * 0.7,
    }
    const k = Math.min(box.w / upload.width, box.h / upload.height)
    const layer: ImageLayer = {
      kind: "image",
      id: newId(),
      name: upload.name,
      src: upload.src,
      x: sign.widthMm / 2,
      y: sign.heightMm / 2,
      w: upload.width * k,
      h: upload.height * k,
      rotation: 0,
      flipX: false,
      flipY: false,
      opacity: 1,
    }
    commit({ ...scene, layers: [...scene.layers, layer] })
    setSelectedId(layer.id)
  }

  async function onFiles(files: File[]) {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue
      const src = URL.createObjectURL(file)
      const img = new Image()
      img.decoding = "async"
      img.src = src
      try {
        await img.decode()
      } catch {
        URL.revokeObjectURL(src)
        continue
      }
      images.set(src, img)
      const upload: Upload = {
        src,
        name: file.name.replace(/\.[^.]+$/, "") || "Image",
        width: img.naturalWidth || 1000,
        height: img.naturalHeight || 1000,
      }
      setUploads((u) => [upload, ...u])
      setImagesVersion((v) => v + 1)
      addImageLayer(upload)
    }
    setSheetOpen(false)
  }

  function addText(preset: { text: string; size: number; weight: number; family: string }) {
    const layer: TextLayer = {
      kind: "text",
      id: newId(),
      name: preset.text.split("\n")[0].slice(0, 24) || "Text",
      text: preset.text,
      x: sign.widthMm / 2,
      y: sign.heightMm / 2,
      fontSize: Math.min(sign.widthMm, sign.heightMm) * preset.size,
      fontFamily: preset.family,
      fontWeight: preset.weight,
      italic: false,
      color: isDark(scene.background) ? "#ffffff" : "#16161a",
      align: "center",
      letterSpacing: 0,
      rotation: 0,
      opacity: 1,
    }
    commit({ ...scene, layers: [...scene.layers, layer] })
    setSelectedId(layer.id)
    setSheetOpen(false)
    requestAnimationFrame(() => textInput.current?.select())
  }

  function removeLayer(id: string) {
    commit({ ...scene, layers: scene.layers.filter((l) => l.id !== id) })
    setSelectedId(null)
  }

  function duplicateLayer(id: string) {
    const layer = scene.layers.find((l) => l.id === id)
    if (!layer) return
    const offset = Math.min(sign.widthMm, sign.heightMm) * 0.04
    const copy = { ...layer, id: newId(), x: layer.x + offset, y: layer.y + offset }
    const index = scene.layers.indexOf(layer)
    const layers = [...scene.layers]
    layers.splice(index + 1, 0, copy)
    commit({ ...scene, layers })
    setSelectedId(copy.id)
  }

  function moveLayer(id: string, direction: 1 | -1) {
    const index = scene.layers.findIndex((l) => l.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= scene.layers.length) return
    const layers = [...scene.layers]
    ;[layers[index], layers[target]] = [layers[target], layers[index]]
    commit({ ...scene, layers })
  }

  function fitLayer(id: string, mode: "fit" | "fill") {
    const layer = scene.layers.find((l) => l.id === id)
    if (!layer || layer.kind !== "image") return
    const k =
      mode === "fill"
        ? Math.max(sign.widthMm / layer.w, sign.heightMm / layer.h)
        : Math.min((sign.widthMm - sign.safeMm * 2) / layer.w, (sign.heightMm - sign.safeMm * 2) / layer.h)
    updateLayer(id, {
      w: layer.w * k,
      h: layer.h * k,
      x: sign.widthMm / 2,
      y: sign.heightMm / 2,
      rotation: 0,
    })
  }

  function changeVariant(id: number) {
    const next = variants.find((v) => v.id === id)
    if (!next || next.id === variant.id) return
    const nextSign = signFrom(material, variantSize(next))
    const rescaled = rescaleScene(scene, sign, nextSign)
    committed.current = rescaled
    setScene(rescaled)
    setPast([])
    setFuture([])
    setVariantId(next.id)
    const url = new URL(window.location.href)
    url.searchParams.set("size", String(next.id))
    window.history.replaceState(null, "", url)
  }

  /* --------------------------------------------------------------- keyboard */

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]")) return
      if (preview) {
        if (e.key === "Escape") showDesign()
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault()
        redo()
        return
      }
      if (!selected) return
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        removeLayer(selected.id)
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault()
        duplicateLayer(selected.id)
      } else if (e.key === "Escape") {
        setSelectedId(null)
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0
        updateLayer(selected.id, { x: selected.x + dx, y: selected.y + dy })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  // Canvas text needs its fonts loaded up front, and a repaint when they land.
  useEffect(() => {
    const repaint = () => setImagesVersion((v) => v + 1)
    for (const f of FONTS) {
      for (const weight of [400, 600, 800]) {
        void document.fonts.load(`${weight} 32px ${resolveFontFamily(f.family)}`).then(repaint, () => {})
      }
    }
    document.fonts.addEventListener("loadingdone", repaint)
    return () => document.fonts.removeEventListener("loadingdone", repaint)
  }, [])

  // Uploaded files live only in this tab: warn before they are lost.
  useEffect(() => {
    if (!dirty || save.kind === "done") return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty, save.kind])

  /* ------------------------------------------------------------ add to cart */

  async function addToCart() {
    if (!dirty || save.kind === "working") return
    setSelectedId(null)
    try {
      setSave({ kind: "working", step: "Rendering print file" })
      await document.fonts.ready
      const res = printResolution(sign)
      const [printBlob, previewBlob] = await Promise.all([
        canvasToBlob(renderPrint(scene, sign, images, res), "image/png"),
        canvasToBlob(renderPreview(scene, sign, images), "image/webp", 0.9),
      ])

      setSave({ kind: "working", step: "Uploading your design" })
      const form = new FormData()
      form.append("print", printBlob, "print.png")
      form.append("preview", previewBlob, "preview.webp")
      form.append(
        "meta",
        JSON.stringify({
          productId: product.id,
          productName: product.name,
          variantId: variant.id,
          variantLabel: variantLabel(variant),
          widthMm: sign.widthMm,
          heightMm: sign.heightMm,
          shape: sign.shape,
          printWidthPx: res.width,
          printHeightPx: res.height,
          dpi: res.dpi,
          layers: scene.layers.length,
        }),
      )
      const upload = await fetch("/api/designs", { method: "POST", body: form })
      if (!upload.ok) throw new Error("We couldn't save your design. Please try again.")
      const saved = (await upload.json()) as { id: string; previewUrl: string }

      setSave({ kind: "working", step: "Adding to cart" })
      await addDesignToCart(saved.id)
      setSave({ kind: "done", previewUrl: saved.previewUrl })
    } catch (error) {
      setSave({ kind: "error", message: error instanceof Error ? error.message : "Something went wrong." })
    }
  }

  /**
   * The design link rides along as the product's "Design link" field
   * ("produktfält"), so every design becomes its own cart line. The product is
   * re-read here because the merchant can change its fields, and their ids, at
   * any time.
   */
  async function addDesignToCart(designId: string): Promise<void> {
    const fresh = await client.products.get(product.id)
    const field = fresh && designField(fresh)
    if (!field) throw new Error("The design was saved, but this sign can't take a design right now.")

    const cart = await cartStore.add({
      productId: product.id,
      variantId: variant.id,
      quantity: 1,
      properties: [{ propertyId: field.id, value: designPageUrl(designId) }],
    })
    if (!cart) throw new Error("The design was saved, but adding it to the cart failed.")
  }

  /* ------------------------------------------------------------------- view */

  const panelTitle: Record<Tab, string> = {
    upload: "Images",
    text: "Text",
    background: "Background",
    layers: "Layers",
  }

  function openTab(next: Tab) {
    setTab(next)
    setSheetOpen((open) => (tab === next ? !open : true))
  }

  const lowRes = scene.layers.some(
    (l) => l.kind === "image" && (effectiveDpi(l, images.get(l.src)) ?? 999) < MIN_DPI,
  )

  return (
    <div className="designer" data-sheet={sheetOpen || undefined} data-preview={preview || undefined}>
      <header className="d-top">
        <Link href={`/products/${product.slug}`} className="icon-btn ghost" aria-label="Back to product">
          <ArrowLeftIcon />
        </Link>
        <div className="d-title">
          <span className="d-kicker">{material.label}</span>
          <strong>{product.name}</strong>
        </div>

        <div className="d-sizes" role="radiogroup" aria-label="Size">
          {variants.map((v) => (
            <button
              key={v.id}
              role="radio"
              aria-checked={v.id === variant.id}
              className="d-size"
              onClick={() => changeVariant(v.id)}
            >
              {variantLabel(v)}
            </button>
          ))}
        </div>

        <div className="d-history">
          <button className="icon-btn ghost" onClick={undo} disabled={!past.length} aria-label="Undo" title="Undo (⌘Z)">
            <UndoIcon />
          </button>
          <button className="icon-btn ghost" onClick={redo} disabled={!future.length} aria-label="Redo" title="Redo (⇧⌘Z)">
            <RedoIcon />
          </button>
        </div>

        <div className="d-buy">
          <span className="d-price">{money(variant.price.price)}</span>
          <button className="btn btn-primary" aria-label="Add to cart" onClick={addToCart} disabled={!dirty || save.kind === "working"}>
            <BagIcon />
            <span>Add to cart</span>
          </button>
        </div>
      </header>

      {/* Mounted outside the panels so every upload button can reach it. */}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void onFiles(Array.from(e.target.files ?? []))
          e.target.value = ""
        }}
      />

      <nav className="d-rail" aria-label="Tools">
        <RailButton active={tab === "upload"} onClick={() => openTab("upload")} icon={<UploadIcon />} label="Images" />
        <RailButton active={tab === "text"} onClick={() => openTab("text")} icon={<TextIcon />} label="Text" />
        <RailButton
          active={tab === "background"}
          onClick={() => openTab("background")}
          icon={<PaletteIcon />}
          label="Colour"
        />
        <RailButton
          active={tab === "layers"}
          onClick={() => openTab("layers")}
          icon={<LayersIcon />}
          label="Layers"
          badge={scene.layers.length || undefined}
        />
      </nav>

      <aside className="d-panel" aria-label={panelTitle[tab]}>
        <div className="d-panel-head">
          <h2>{panelTitle[tab]}</h2>
          <button className="icon-btn ghost sheet-close" onClick={() => setSheetOpen(false)} aria-label="Close panel">
            <CloseIcon />
          </button>
        </div>

        {tab === "upload" && (
          <div className="d-panel-body">
            <button className="dropzone" onClick={() => fileInput.current?.click()}>
              <span className="dropzone-icon">
                <UploadIcon />
              </span>
              <strong>Upload images</strong>
              <span>PNG, JPG, SVG or WebP · or drop them on the sign</span>
            </button>
            {uploads.length > 0 && (
              <>
                <p className="d-label">Your uploads · tap to add again</p>
                <div className="upload-grid">
                  {uploads.map((u) => (
                    <button key={u.src} className="upload-thumb" onClick={() => addImageLayer(u)} title={u.name}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u.src} alt={u.name} />
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="d-hint">
              For a sharp print, use images of at least {MIN_DPI} DPI at the size you place them. We flag anything
              that falls short.
            </p>
          </div>
        )}

        {tab === "text" && (
          <div className="d-panel-body">
            <button
              className="text-preset"
              style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26 }}
              onClick={() => addText({ text: "Add a headline", size: 0.16, weight: 800, family: FONTS[0].family })}
            >
              Add a headline
            </button>
            <button
              className="text-preset"
              style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: 17 }}
              onClick={() => addText({ text: "Add a subheading", size: 0.08, weight: 500, family: FONTS[1].family })}
            >
              Add a subheading
            </button>
            <button
              className="text-preset"
              style={{ fontFamily: "var(--font-script)", fontWeight: 600, fontSize: 26 }}
              onClick={() => addText({ text: "Welcome", size: 0.18, weight: 600, family: FONTS[4].family })}
            >
              Welcome
            </button>
            <button
              className="text-preset"
              style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 15, letterSpacing: "0.08em" }}
              onClick={() => addText({ text: "NO. 42", size: 0.12, weight: 600, family: FONTS[3].family })}
            >
              NO. 42
            </button>
          </div>
        )}

        {tab === "background" && (
          <div className="d-panel-body">
            <p className="d-label">Background colour</p>
            <div className="swatches">
              <button
                className="swatch swatch-none"
                aria-pressed={scene.background === "transparent"}
                onClick={() => commit({ ...scene, background: "transparent" })}
                title={material.key === "wood" || material.key === "acrylic" ? "Show the material" : "No background"}
              >
                <span className="sr-only">No background</span>
              </button>
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  className="swatch"
                  style={{ background: c }}
                  aria-pressed={scene.background === c}
                  aria-label={c}
                  onClick={() => commit({ ...scene, background: c })}
                />
              ))}
              <label className="swatch swatch-custom" title="Custom colour">
                <input
                  type="color"
                  value={scene.background === "transparent" ? "#ffffff" : scene.background}
                  onChange={(e) => setScene({ ...scene, background: e.target.value })}
                  onBlur={() => commit(scene)}
                />
                <PlusIcon />
              </label>
            </div>
            <p className="d-hint">
              {material.key === "wood"
                ? "Choose no background to let the birch grain show through your design."
                : material.key === "acrylic"
                  ? "Choose no background for a clear, floating look."
                  : `Printed edge to edge on ${material.label.toLowerCase()}.`}
            </p>
          </div>
        )}

        {tab === "layers" && (
          <div className="d-panel-body">
            {scene.layers.length === 0 ? (
              <p className="d-hint">Nothing here yet. Upload an image or add text to get started.</p>
            ) : (
              <ul className="layer-list">
                {[...scene.layers].reverse().map((l) => (
                  <li key={l.id}>
                    <button
                      className="layer-row"
                      aria-pressed={l.id === selectedId}
                      onClick={() => {
                        setSelectedId(l.id)
                        setSheetOpen(false)
                      }}
                    >
                      <span className="layer-thumb">
                        {l.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.src} alt="" />
                        ) : (
                          <TextIcon />
                        )}
                      </span>
                      <span className="layer-name">{l.kind === "text" ? l.text.split("\n")[0] || "Text" : l.name}</span>
                      {l.kind === "image" && (effectiveDpi(l, images.get(l.src)) ?? 999) < MIN_DPI && (
                        <AlertIcon className="warn" width={16} height={16} />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>

      <main className="d-stage">
        <div className="d-stage-toolbar">
          <div className="d-view-switch" role="group" aria-label="Designer view">
            <button ref={designButton} type="button" aria-pressed={!preview} onClick={showDesign}>Design</button>
            <button type="button" aria-pressed={preview} onClick={() => {
              setSheetOpen(false)
              setPreview(true)
            }}>Preview</button>
          </div>
          {preview && (
            <label className="d-setting-picker">
              <span>Setting</span>
              <select value={previewSettingId} onChange={(e) => setPreviewSettingId(e.target.value as PreviewSettingId)}>
                {PREVIEW_SETTINGS.map((setting) => <option key={setting.id} value={setting.id}>{setting.label}</option>)}
              </select>
            </label>
          )}
        </div>
        {preview && (
          <ScenePreview
            scene={scene}
            sign={sign}
            images={images}
            imagesVersion={imagesVersion}
            setting={PREVIEW_SETTINGS.find((setting) => setting.id === previewSettingId) ?? PREVIEW_SETTINGS[0]}
            sizeLabel={variantLabel(variant)}
            onEdit={showDesign}
          />
        )}
        <div className="d-workspace" hidden={preview}>
          <Stage
            scene={scene}
            sign={sign}
            images={images}
            imagesVersion={imagesVersion}
            selectedId={selectedId}
            zoom={zoom}
            onSelect={setSelectedId}
            onChange={onStageChange}
            onZoom={setZoom}
            onFiles={(f) => void onFiles(f)}
            onEditText={(id) => {
              setSelectedId(id)
              requestAnimationFrame(() => textInput.current?.focus())
            }}
          />

          {!dirty && (
            <div className="empty-state">
              <button className="empty-card" onClick={() => fileInput.current?.click()}>
                <ImageIcon width={28} height={28} />
                <strong>Drop an image here</strong>
                <span>or click to upload · then drag, resize and rotate freely</span>
              </button>
            </div>
          )}

          <div className="zoom-ctl" role="group" aria-label="Zoom">
            <button className="icon-btn ghost" onClick={() => setZoom((z) => clampZoom(z / 1.25))} aria-label="Zoom out">
              <MinusIcon />
            </button>
            <button className="zoom-value" onClick={() => setZoom(1)} title="Fit to screen">
              {Math.round(zoom * 100)}%
            </button>
            <button className="icon-btn ghost" onClick={() => setZoom((z) => clampZoom(z * 1.25))} aria-label="Zoom in">
              <PlusIcon />
            </button>
          </div>

          <div className="stage-legend">
            <span className="legend-safe" /> Safe zone — keep text inside
            {lowRes && (
              <span className="legend-warn">
                <AlertIcon width={14} height={14} /> An image may print blurry
              </span>
            )}
          </div>
        </div>
      </main>

      {/* Always mounted, so selecting and deselecting never reflows the stage. */}
      <aside
        className="d-inspector"
        data-empty={!selected || undefined}
        aria-label={selected ? "Selected layer" : "Sign overview"}
      >
        {selected ? (
        <Inspector
          key={selected.id}
          layer={selected}
          sign={sign}
          images={images}
          textInput={textInput}
          onUpdate={(patch) => updateLayer(selected.id, patch)}
          onLive={(patch) =>
            setScene({
              ...scene,
              layers: scene.layers.map((l) => (l.id === selected.id ? ({ ...l, ...patch } as Layer) : l)),
            })
          }
          onCommit={() => commit(scene)}
          onRemove={() => removeLayer(selected.id)}
          onDuplicate={() => duplicateLayer(selected.id)}
          onMove={(d) => moveLayer(selected.id, d)}
          onFit={(mode) => fitLayer(selected.id, mode)}
          onClose={() => setSelectedId(null)}
          isTop={scene.layers.at(-1)?.id === selected.id}
          isBottom={scene.layers[0]?.id === selected.id}
        />
        ) : (
          <SignOverview
            sign={sign}
            material={material}
            variantName={variantLabel(variant)}
            layerCount={scene.layers.length}
            onUpload={() => fileInput.current?.click()}
            onText={() => openTab("text")}
          />
        )}
      </aside>

      {save.kind !== "idle" && (
        <div className="modal-scrim" role="dialog" aria-modal="true" aria-live="polite">
          <div className="modal">
            {save.kind === "working" && (
              <>
                <div className="spinner" aria-hidden="true" />
                <h3>{save.step}…</h3>
                <p>Hang tight, this only takes a moment.</p>
              </>
            )}
            {save.kind === "done" && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="modal-preview" src={save.previewUrl} alt="Your design" />
                <h3>
                  <CheckIcon /> Added to your cart
                </h3>
                <p>
                  {product.name}, {variantLabel(variant)} · {money(variant.price.price)}
                </p>
                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => setSave({ kind: "idle" })}>
                    Keep designing
                  </button>
                  <button className="btn btn-primary" onClick={() => router.push("/cart")}>
                    View cart
                  </button>
                </div>
              </>
            )}
            {save.kind === "error" && (
              <>
                <h3>
                  <AlertIcon /> Something went wrong
                </h3>
                <p>{save.message}</p>
                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => setSave({ kind: "idle" })}>
                    Close
                  </button>
                  <button className="btn btn-primary" onClick={addToCart}>
                    Try again
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RailButton(props: { active: boolean; onClick: () => void; icon: ReactNode; label: string; badge?: number }) {
  return (
    <button className="rail-btn" aria-pressed={props.active} onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
      {props.badge ? <em className="rail-badge">{props.badge}</em> : null}
    </button>
  )
}

/* ------------------------------------------------------------------ inspector */

type InspectorProps = {
  layer: Layer
  sign: SignSpec
  images: ImageCache
  textInput: React.RefObject<HTMLTextAreaElement | null>
  onUpdate: (patch: Partial<ImageLayer> | Partial<TextLayer>) => void
  onLive: (patch: Partial<ImageLayer> | Partial<TextLayer>) => void
  onCommit: () => void
  onRemove: () => void
  onDuplicate: () => void
  onMove: (d: 1 | -1) => void
  onFit: (mode: "fit" | "fill") => void
  onClose: () => void
  isTop: boolean
  isBottom: boolean
}

function Inspector({ textInput, ...p }: InspectorProps) {
  const { layer, sign } = p
  const { w, h } = layerSize(layer)
  const dpi = layer.kind === "image" ? effectiveDpi(layer, p.images.get(layer.src)) : null
  const degrees = Math.round((layer.rotation * 180) / Math.PI)

  return (
    <>
      <div className="d-panel-head">
        <h2>{layer.kind === "image" ? "Image" : "Text"}</h2>
        <button className="icon-btn ghost" onClick={p.onClose} aria-label="Deselect">
          <CloseIcon />
        </button>
      </div>

      <div className="d-panel-body">
        {layer.kind === "text" && (
          <>
            <textarea
              ref={textInput}
              className="text-edit"
              value={layer.text}
              rows={Math.min(5, layer.text.split("\n").length + 1)}
              onChange={(e) => p.onLive({ text: e.target.value, name: e.target.value.split("\n")[0].slice(0, 24) })}
              onBlur={p.onCommit}
              aria-label="Text"
            />
            <div className="font-list" role="radiogroup" aria-label="Font">
              {FONTS.map((f) => (
                <button
                  key={f.label}
                  role="radio"
                  aria-checked={layer.fontFamily === f.family}
                  style={{ fontFamily: f.family }}
                  onClick={() => p.onUpdate({ fontFamily: f.family })}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="seg-row">
              <div className="seg" role="group" aria-label="Style">
                <button
                  aria-pressed={layer.fontWeight >= 700}
                  onClick={() => p.onUpdate({ fontWeight: layer.fontWeight >= 700 ? 400 : 800 })}
                  style={{ fontWeight: 800 }}
                >
                  B
                </button>
                <button
                  aria-pressed={layer.italic}
                  onClick={() => p.onUpdate({ italic: !layer.italic })}
                  style={{ fontStyle: "italic", fontFamily: "var(--font-serif)" }}
                >
                  I
                </button>
              </div>
              <div className="seg" role="radiogroup" aria-label="Alignment">
                {(["left", "center", "right"] as const).map((a) => (
                  <button key={a} role="radio" aria-checked={layer.align === a} onClick={() => p.onUpdate({ align: a })}>
                    {a === "left" ? <AlignLeftIcon /> : a === "center" ? <AlignCenterIcon /> : <AlignRightIcon />}
                  </button>
                ))}
              </div>
            </div>
            <p className="d-label">Colour</p>
            <div className="swatches small">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  className="swatch"
                  style={{ background: c }}
                  aria-pressed={layer.color === c}
                  aria-label={c}
                  onClick={() => p.onUpdate({ color: c })}
                />
              ))}
              <label className="swatch swatch-custom" title="Custom colour">
                <input
                  type="color"
                  value={layer.color}
                  onChange={(e) => p.onLive({ color: e.target.value })}
                  onBlur={p.onCommit}
                />
                <PlusIcon />
              </label>
            </div>
            <Slider
              label="Letter spacing"
              value={layer.letterSpacing}
              min={-5}
              max={40}
              step={1}
              format={(v) => `${v}`}
              onLive={(v) => p.onLive({ letterSpacing: v })}
              onCommit={p.onCommit}
            />
          </>
        )}

        {layer.kind === "image" && dpi !== null && (
          <div className={`quality ${dpi < MIN_DPI ? "bad" : dpi < 120 ? "ok" : "good"}`}>
            {dpi < MIN_DPI ? <AlertIcon width={16} height={16} /> : <CheckIcon width={16} height={16} />}
            <span>
              {dpi < MIN_DPI ? "Low resolution" : dpi < 120 ? "Good quality" : "Excellent quality"} · {dpi} DPI
            </span>
          </div>
        )}

        <div className="metrics">
          <span>
            <em>W</em> {(w / 10).toFixed(1)} cm
          </span>
          <span>
            <em>H</em> {(h / 10).toFixed(1)} cm
          </span>
          <span>
            <em>∠</em> {degrees}°
          </span>
        </div>

        <Slider
          label="Rotation"
          value={degrees}
          min={-180}
          max={180}
          step={1}
          format={(v) => `${v}°`}
          onLive={(v) => p.onLive({ rotation: (v * Math.PI) / 180 })}
          onCommit={p.onCommit}
        />
        <Slider
          label="Opacity"
          value={Math.round(layer.opacity * 100)}
          min={5}
          max={100}
          step={1}
          format={(v) => `${v}%`}
          onLive={(v) => p.onLive({ opacity: v / 100 })}
          onCommit={p.onCommit}
        />

        <div className="tool-grid">
          <ToolButton
            icon={<CenterIcon />}
            label="Center"
            onClick={() => p.onUpdate({ x: sign.widthMm / 2, y: sign.heightMm / 2 })}
          />
          {layer.kind === "image" && (
            <>
              <ToolButton icon={<FitIcon />} label="Fit" onClick={() => p.onFit("fit")} />
              <ToolButton icon={<ImageIcon />} label="Fill" onClick={() => p.onFit("fill")} />
              <ToolButton icon={<FlipHIcon />} label="Flip H" onClick={() => p.onUpdate({ flipX: !layer.flipX })} />
              <ToolButton icon={<FlipVIcon />} label="Flip V" onClick={() => p.onUpdate({ flipY: !layer.flipY })} />
            </>
          )}
          <ToolButton icon={<UpIcon />} label="Forward" onClick={() => p.onMove(1)} disabled={p.isTop} />
          <ToolButton icon={<DownIcon />} label="Backward" onClick={() => p.onMove(-1)} disabled={p.isBottom} />
          <ToolButton icon={<CopyIcon />} label="Duplicate" onClick={p.onDuplicate} />
          <ToolButton icon={<TrashIcon />} label="Delete" onClick={p.onRemove} danger />
        </div>
      </div>
    </>
  )
}

/** What the sidebar shows while nothing is selected. */
function SignOverview(props: {
  sign: SignSpec
  material: Material
  variantName: string
  layerCount: number
  onUpload: () => void
  onText: () => void
}) {
  const { sign, material } = props
  const print = printResolution(sign)
  return (
    <>
      <div className="d-panel-head">
        <h2>Your sign</h2>
      </div>
      <div className="d-panel-body">
        <dl className="overview">
          <div>
            <dt>Material</dt>
            <dd>{material.label}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{props.variantName}</dd>
          </div>
          <div>
            <dt>Print file</dt>
            <dd>
              {print.width} × {print.height} px · {print.dpi} DPI
            </dd>
          </div>
          <div>
            <dt>Layers</dt>
            <dd>{props.layerCount}</dd>
          </div>
        </dl>

        <div className="tool-grid two">
          <ToolButton icon={<UploadIcon />} label="Upload image" onClick={props.onUpload} />
          <ToolButton icon={<TextIcon />} label="Add text" onClick={props.onText} />
        </div>

        <p className="d-hint">
          {props.layerCount > 0
            ? "Click anything on the sign to move, resize or rotate it."
            : "Start with an image or some text. You can place everything freely."}
        </p>

        <p className="d-label">Shortcuts</p>
        <ul className="shortcuts">
          <li>
            <span>Nudge</span>
            <kbd>←↑→↓</kbd>
          </li>
          <li>
            <span>Nudge 1 cm</span>
            <kbd>⇧ + arrows</kbd>
          </li>
          <li>
            <span>Duplicate</span>
            <kbd>⌘D</kbd>
          </li>
          <li>
            <span>Delete</span>
            <kbd>⌫</kbd>
          </li>
          <li>
            <span>Undo / redo</span>
            <kbd>⌘Z / ⇧⌘Z</kbd>
          </li>
          <li>
            <span>Free move (no snap)</span>
            <kbd>⌥ drag</kbd>
          </li>
          <li>
            <span>Rotate in 15° steps</span>
            <kbd>⇧ rotate</kbd>
          </li>
        </ul>
      </div>
    </>
  )
}

function ToolButton(props: {
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button className="tool-btn" data-danger={props.danger || undefined} onClick={props.onClick} disabled={props.disabled}>
      {props.icon}
      <span>{props.label}</span>
    </button>
  )
}

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onLive: (v: number) => void
  onCommit: () => void
}) {
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{props.label}</span>
        <output>{props.format(props.value)}</output>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onLive(Number(e.target.value))}
        onPointerUp={props.onCommit}
        onKeyUp={props.onCommit}
      />
    </label>
  )
}

function isDark(color: string) {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return false
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b < 140
}
