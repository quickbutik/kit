export type MeasurementUnit = "cm" | "in";

// The existing demo collection's general BODY measurements, not garment specs.
// Keep the full guide and the product-page guide on the same reference.
export const bodySizes = [
  { size: "XS", chest: [82, 88], waist: [66, 72], hips: [86, 92] },
  { size: "S", chest: [88, 94], waist: [72, 78], hips: [92, 98] },
  { size: "M", chest: [94, 100], waist: [78, 84], hips: [98, 104] },
  { size: "L", chest: [100, 106], waist: [84, 90], hips: [104, 110] },
  { size: "XL", chest: [106, 112], waist: [90, 96], hips: [110, 116] },
  { size: "XXL", chest: [112, 118], waist: [96, 102], hips: [116, 122] },
] as const;

export const sockSizes = [
  { size: "S/M", eu: "36–40" },
  { size: "L/XL", eu: "41–46" },
] as const;

export function measurementRange(
  values: readonly number[],
  unit: MeasurementUnit,
) {
  return values
    .map((value) => (unit === "cm" ? value : (value / 2.54).toFixed(1)))
    .join("–");
}
