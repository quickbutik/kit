import type { Material } from "./signs"

/** Sample artwork for the illustrated product cards. */
export const SAMPLE: Record<Material["key"], { label: string; sub?: string }> = {
  aluminium: { label: "OPEN DAILY", sub: "08:00 — 18:00" },
  acrylic: { label: "Studio Nord", sub: "RECEPTION" },
  wood: { label: "Fika", sub: "EST. 2026" },
  banner: { label: "GRAND OPENING", sub: "SATURDAY" },
  plate: { label: "Room 204" },
  round: { label: "42" },
}

/** Illustrative installations, shared by the home and product pages. */
export const SCENES = [
  {
    material: "acrylic",
    title: "At the office",
    setting: "Office reception",
    description: "A clear acrylic sign gives your reception a considered finish.",
    image: "/images/scenes/office-acrylic.webp",
    alt: "Clear Studio Nord acrylic reception sign on a limestone wall beside an oak office counter",
  },
  {
    material: "aluminium",
    title: "At the entrance",
    setting: "Building entrance",
    description: "Durable aluminium makes a clear first impression, indoors or out.",
    image: "/images/scenes/building-aluminium.webp",
    alt: "Aluminium OPEN DAILY sign fixed to a stone wall beside a glass building entrance",
  },
  {
    material: "wood",
    title: "At the café",
    setting: "Café interior",
    description: "Natural birch brings warmth to cafés and shared spaces.",
    image: "/images/scenes/cafe-wood.webp",
    alt: "Birch plywood Fika sign above a café counter with a ceramic cup and an espresso machine",
  },
] as const satisfies ReadonlyArray<{
  material: Material["key"]
  title: string
  setting: string
  description: string
  image: string
  alt: string
}>

export function sceneFor(material: Material["key"]) {
  return SCENES.find((scene) => scene.material === material)
}
