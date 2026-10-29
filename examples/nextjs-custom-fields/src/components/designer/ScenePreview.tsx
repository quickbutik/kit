"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import { drawSign, signPath, type ImageCache } from "./render"
import { previewWidth, type PreviewSetting } from "./preview-settings"
import type { Scene, SignSpec } from "./scene"

export function ScenePreview({
  scene,
  sign,
  images,
  imagesVersion,
  setting,
  sizeLabel,
  onEdit,
}: {
  scene: Scene
  sign: SignSpec
  images: ImageCache
  imagesVersion: number
  setting: PreviewSetting
  sizeLabel: string
  onEdit: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loadedImage, setLoadedImage] = useState("")
  const [failedImage, setFailedImage] = useState("")
  const loaded = loadedImage === setting.image
  const failed = failedImage === setting.image

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Render only the sign. The background never enters the artwork or exports.
    const scale = Math.min(3, 1600 / Math.max(sign.widthMm, sign.heightMm))
    canvas.width = Math.max(1, Math.round(sign.widthMm * scale))
    canvas.height = Math.max(1, Math.round(sign.heightMm * scale))
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    drawSign(ctx, scene, sign, images, { ghost: false, guides: false, shadow: false, environment: true })
    signPath(ctx, sign)
    ctx.lineWidth = 1 / scale
    ctx.strokeStyle = "rgba(255,255,255,0.5)"
    ctx.stroke()
  }, [scene, sign, images, imagesVersion])

  return (
    <div className="scene-preview">
      <div className="scene-preview-stage">
        <div className="scene-preview-photo" aria-busy={!loaded && !failed}>
          <Image
            key={setting.image}
            src={setting.image}
            alt={setting.alt}
            fill
            sizes="(max-width: 860px) 100vw, (max-width: 1400px) 90vw, 1200px"
            loading="eager"
            onLoad={() => {
              setLoadedImage(setting.image)
              setFailedImage("")
            }}
            onError={() => setFailedImage(setting.image)}
          />
          {!loaded && !failed && <p className="scene-preview-status" role="status">Loading setting…</p>}
          {failed && (
            <div className="scene-preview-status" role="alert">
              <p>This setting couldn’t load.</p>
              <button type="button" className="btn btn-ghost" onClick={onEdit}>Back to design</button>
            </div>
          )}
          <canvas
            ref={canvasRef}
            className="scene-preview-sign"
            role="img"
            aria-label={`Your ${sizeLabel} sign with ${scene.layers.length} artwork ${scene.layers.length === 1 ? "layer" : "layers"} in ${setting.label.toLowerCase()}`}
            style={{
              visibility: loaded && !failed ? "visible" : "hidden",
              left: `${setting.x * 100}%`,
              top: `${setting.y * 100}%`,
              width: `${previewWidth(sign, setting) * 100}%`,
              transform: `translate(-50%, -50%) perspective(100cqw) rotateY(${setting.rotateY}deg) skewY(${setting.skewY}deg)`,
            }}
          />
        </div>
      </div>
      <div className="scene-preview-caption">
        <div>
          <p><strong>Your design</strong> · {sizeLabel}</p>
          <p className="muted">Scene scale and lighting are approximate.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onEdit}>
          {scene.layers.length ? "Continue editing" : "Add your artwork"}
        </button>
      </div>
    </div>
  )
}
