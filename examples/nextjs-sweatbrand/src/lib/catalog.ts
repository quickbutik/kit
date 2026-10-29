import {
  getOptionGroups,
  type Category,
  type CustomerAccountsConfig,
  type Product,
  type Shop,
} from "@quickbutik/kit";

export type CatalogCategory = Category & {
  name: string;
  slug: string;
  productIds: string[];
};

// One snapshot of the Quickbutik shop, read on the server and shared with the
// client. Category membership is not part of a storefront product, so it is
// collected per category.
export type Catalog = {
  shop: Shop & { currency: string; demo: boolean };
  // Customer login and the customer club, as switched on in the admin.
  accounts: CustomerAccountsConfig;
  products: Product[];
  categories: CatalogCategory[];
};

// Navigation sections, by Quickbutik category slug. Every other category with
// products is a product type (Tops, Bottoms, …).
export const departments = [
  { slug: "new-arrivals", audience: false },
  { slug: "women", audience: true },
  { slug: "men", audience: true },
] as const;
export const newArrivalsSlug = "new-arrivals";

export type Sort = "featured" | "price-low" | "price-high" | "name";

const swatches: Record<string, { color: string; light?: boolean }> = {
  "washed black": { color: "#343536" },
  onyx: { color: "#222322" },
  eucalyptus: { color: "#96a58d" },
  "grey marl": { color: "#b5b6b3", light: true },
  espresso: { color: "#5b4136" },
  bone: { color: "#e5e0d5", light: true },
  forest: { color: "#2d4c37" },
  olive: { color: "#7e845a" },
  sage: { color: "#909f7d" },
  oat: { color: "#dad2be", light: true },
  "cream / forest": { color: "#e3e0d4", light: true },
  charcoal: { color: "#52534f" },
  navy: { color: "#1f2a3d" },
};

export function swatch(color: string) {
  return swatches[color.toLowerCase()];
}

export function productPath(product: Product) {
  return `/products/${product.slug}`;
}

export function categoryPath(slug: string, filter?: string) {
  return `/category/${slug}${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`;
}

export function productBySlug(catalog: Catalog, slug: string) {
  return catalog.products.find(
    (product) => product.slug?.toLowerCase() === slug.toLowerCase(),
  );
}

export function productById(catalog: Catalog, id: string | number) {
  const prefixed = typeof id === "number" ? `prod_${id}` : id;
  return catalog.products.find((product) => product.id === prefixed);
}

export function categoryBySlug(catalog: Catalog, slug: string) {
  return catalog.categories.find((category) => category.slug === slug);
}

function department(slug: string) {
  return departments.find((item) => item.slug === slug);
}

export function isDepartment(category: CatalogCategory) {
  return !!department(category.slug);
}

// Products in a category, in catalog order, optionally narrowed to those that
// are also in a second category ("Women" × "Tops").
export function productsIn(
  catalog: Catalog,
  category: CatalogCategory,
  filter?: CatalogCategory,
) {
  return catalog.products.filter(
    (product) =>
      category.productIds.includes(product.id) &&
      (!filter || filter.productIds.includes(product.id)),
  );
}

// Which other categories narrow this one down: product types within a
// department, departments within a product type, never two audiences.
export function filterCategories(catalog: Catalog, category: CatalogCategory) {
  return catalog.categories.filter(
    (other) =>
      other.id !== category.id &&
      !(
        department(other.slug)?.audience && department(category.slug)?.audience
      ) &&
      (isDepartment(other) || isDepartment(category)) &&
      productsIn(catalog, category, other).length > 0,
  );
}

export function productTypes(catalog: Catalog) {
  return catalog.categories.filter(
    (category) => !isDepartment(category) && category.productIds.length > 0,
  );
}

export function productType(catalog: Catalog, product: Product) {
  return productTypes(catalog).find((category) =>
    category.productIds.includes(product.id),
  );
}

// The audience departments a product is sold in. Unisex products are in both.
export function audiences(catalog: Catalog, product: Product) {
  return catalog.categories.filter(
    (category) =>
      department(category.slug)?.audience &&
      category.productIds.includes(product.id),
  );
}

export function isNew(catalog: Catalog, product: Product) {
  return !!categoryBySlug(catalog, newArrivalsSlug)?.productIds.includes(
    product.id,
  );
}

// One product per department for the navigation, never the same one twice.
export function featuredProducts(catalog: Catalog) {
  const featured = new Map<string, Product>();
  for (const { slug } of departments) {
    const category = categoryBySlug(catalog, slug);
    if (!category) continue;
    const product = productsIn(catalog, category).find(
      (item) => ![...featured.values()].includes(item),
    );
    if (product) featured.set(slug, product);
  }
  return featured;
}

export function relatedProducts(catalog: Catalog, product: Product, count = 4) {
  const own = audiences(catalog, product).map((category) => category.id);
  const type = productType(catalog, product);
  return catalog.products
    .filter((item) => {
      if (item.id === product.id) return false;
      const theirs = audiences(catalog, item).map((category) => category.id);
      return own.length !== 1 || theirs.length !== 1 || theirs[0] === own[0];
    })
    .sort(
      (a, b) =>
        Number(!!type?.productIds.includes(b.id)) -
        Number(!!type?.productIds.includes(a.id)),
    )
    .slice(0, count);
}

// The price a sale price replaced, or null when the product is not on sale.
// Sale prices are set per variant, so it is read from a variant at the
// product's price.
export function comparePrice(product: Product) {
  const before = product.variants.find(
    (variant) => variant.price.price === product.price,
  )?.price.comparePrice;
  return before && product.price !== null && before > product.price
    ? before
    : null;
}

export function sortProducts(products: Product[], sort: Sort) {
  const price = (product: Product) => product.price ?? 0;
  if (sort === "price-low")
    return [...products].sort((a, b) => price(a) - price(b));
  if (sort === "price-high")
    return [...products].sort((a, b) => price(b) - price(a));
  if (sort === "name")
    return [...products].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? ""),
    );
  return products;
}

// The values of one option ("Color"), in the merchant's order.
export function optionChoices(product: Product, name: RegExp) {
  const option = getOptionGroups(product).find(
    (group) => group.name && name.test(group.name),
  );
  if (!option) return [];
  const values = new Map<
    number,
    { id: number; name: string; position: number }
  >();
  for (const variant of product.variants)
    for (const value of variant.options)
      if (value.optionId === option.id && value.name)
        values.set(value.id, {
          id: value.id,
          name: value.name,
          position: value.position ?? 0,
        });
  return [...values.values()].sort((a, b) => a.position - b.position);
}

export function optionValues(product: Product, name: RegExp) {
  return optionChoices(product, name).map((value) => value.name);
}

// The photo of one color, from either a color value id or a variant id. Each
// color's photo is linked to only one of its variants, so this looks across
// every variant in that color. Undefined means the main image.
export function colorImageId(
  product: Product,
  pick: { valueId?: number | null; variantId?: number | null },
) {
  const option = getOptionGroups(product).find(
    (group) => group.name && colorOption.test(group.name),
  );
  if (!option) return undefined;
  const valueId =
    pick.valueId ??
    product.variants
      .find((variant) => variant.id === pick.variantId)
      ?.options.find((value) => value.optionId === option.id)?.id;
  if (valueId == null) return undefined;
  return (
    product.variants.find(
      (variant) =>
        variant.imageId != null &&
        variant.options.some((value) => value.id === valueId),
    )?.imageId ?? undefined
  );
}

export const colorOption = /^colou?r$/i;
export const sizeOption = /^size$/i;
