import type { SignSpec } from "./scene"

export const PREVIEW_SETTINGS = [
  {
    id: "office",
    label: "Office reception",
    image: "/images/scenes/office-background.webp",
    alt: "A limestone reception wall above an oak counter in a bright office",
    x: 0.48,
    y: 0.4,
    referenceWidth: 0.39,
    maxWidth: 0.54,
    maxHeight: 0.48,
    rotateY: -12,
    skewY: -0.5,
  },
  {
    id: "building",
    label: "Building entrance",
    image: "/images/scenes/building-background.webp",
    alt: "A stone exterior wall beside a glass office building entrance",
    x: 0.445,
    y: 0.405,
    referenceWidth: 0.31,
    maxWidth: 0.36,
    maxHeight: 0.48,
    rotateY: 24,
    skewY: 6,
  },
  {
    id: "cafe",
    label: "Café interior",
    image: "/images/scenes/cafe-background.webp",
    alt: "A warm plaster wall above a café counter with a cup and coffee machine",
    x: 0.5,
    y: 0.35,
    referenceWidth: 0.43,
    maxWidth: 0.58,
    maxHeight: 0.46,
    rotateY: 0,
    skewY: 0,
  },
] as const

export type PreviewSetting = (typeof PREVIEW_SETTINGS)[number]
export type PreviewSettingId = PreviewSetting["id"]

export function defaultPreviewSetting(material: SignSpec["material"]): PreviewSettingId {
  if (material === "wood") return "cafe"
  if (material === "aluminium" || material === "round" || material === "banner") return "building"
  return "office"
}

/** Relative to the 3:2 photo, with larger signs kept inside the available wall. */
export function previewWidth(sign: SignSpec, setting: PreviewSetting): number {
  const width = (sign.widthMm / 600) * setting.referenceWidth
  const height = width * (sign.heightMm / sign.widthMm) * 1.5
  return width * Math.min(1, setting.maxWidth / width, setting.maxHeight / height)
}
