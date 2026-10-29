import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cart, Product } from "@quickbutik/kit";
import { maxItemQuantity, quantityInCart } from "../src/lib/cart";
import {
  categoryBySlug,
  categoryPath,
  colorOption,
  featuredProducts,
  filterCategories,
  isNew,
  optionValues,
  productBySlug,
  productPath,
  productType,
  productsIn,
  relatedProducts,
  sizeOption,
  sortProducts,
  type Catalog,
  type CatalogCategory,
} from "../src/lib/catalog";

function product(
  id: number,
  name: string,
  price: number,
  color: string,
  sizes = ["S", "M", "L"],
): Product {
  return {
    id: `prod_${id}`,
    name,
    price,
    description: null,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    visible: true,
    taxRate: 25,
    seoTitle: null,
    seoDescription: null,
    images: [],
    options: [
      { id: id * 10 + 1, name: "Color", position: 0 },
      { id: id * 10 + 2, name: "Size", position: 1 },
    ],
    variants: sizes.map((size, index) => ({
      id: id * 100 + index,
      sku: `${id}-${size}`,
      barcode: null,
      weight: null,
      hidden: false,
      minPurchaseQty: null,
      maxPurchaseQty: null,
      price: { price, comparePrice: null },
      stock: { stock: null, preorder: null },
      options: [
        { id: id * 1000, name: color, position: 0, optionId: id * 10 + 1 },
        {
          id: id * 1000 + index + 1,
          name: size,
          position: index,
          optionId: id * 10 + 2,
        },
      ],
    })),
  };
}

const tee = product(1, "The Heavyweight Tee", 39900, "Washed black");
const shorts = product(2, "Pace Training Shorts", 49900, "Onyx");
const bra = product(3, "Form Sculpt Bra", 44900, "Eucalyptus");
const cap = product(4, "Run Club Cap", 27900, "Olive", ["One size"]);
function categoryOf(
  id: number,
  name: string,
  slug: string,
  productIds: string[],
): CatalogCategory {
  return {
    id: `cat_${id}`,
    name,
    slug,
    productIds,
    parentId: null,
    description: null,
    description1: null,
    description2: null,
    image: null,
    imageUrl: null,
    seoTitle: null,
    ancestors: [],
    path: slug,
    childCount: 0,
  };
}

const catalog: Catalog = {
  shop: {
    name: "Sweatbrand",
    currency: "SEK",
    demo: true,
    brand: { logo: null, color: { primary: null } },
  },
  accounts: {
    login: {
      enabled: true,
      signupAllowed: false,
      hidePricesForGuests: false,
      hideAddToCartForGuests: false,
    },
    customerGroups: { enabled: false },
    customerClub: { enabled: true, joinMethod: "registration" },
  },
  products: [tee, shorts, bra, cap],
  categories: [
    categoryOf(1, "Produkter", "products", []),
    categoryOf(2, "New arrivals", "new-arrivals", ["prod_2"]),
    categoryOf(3, "Women", "women", ["prod_1", "prod_3", "prod_4"]),
    categoryOf(4, "Men", "men", ["prod_1", "prod_2", "prod_4"]),
    categoryOf(5, "Tops", "tops", ["prod_1", "prod_3"]),
    categoryOf(6, "Bottoms", "bottoms", ["prod_2"]),
    categoryOf(8, "Accessories", "accessories", ["prod_4"]),
  ],
};
const category = (slug: string) => categoryBySlug(catalog, slug)!;

test("products and categories have shareable routes", () => {
  assert.equal(productPath(tee), "/products/the-heavyweight-tee");
  assert.equal(productBySlug(catalog, "THE-HEAVYWEIGHT-TEE"), tee);
  assert.equal(productBySlug(catalog, "missing-product"), undefined);
  assert.equal(categoryPath("women"), "/category/women");
  assert.equal(categoryPath("women", "tops"), "/category/women?filter=tops");
});

test("category pages keep catalog order and narrow by a second category", () => {
  assert.deepEqual(productsIn(catalog, category("women")), [tee, bra, cap]);
  assert.deepEqual(productsIn(catalog, category("women"), category("tops")), [
    tee,
    bra,
  ]);
  assert.deepEqual(
    productsIn(catalog, category("new-arrivals"), category("women")),
    [],
  );
});

test("filters pair departments with product types, never two audiences", () => {
  const slugs = (slug: string) =>
    filterCategories(catalog, category(slug)).map((item) => item.slug);
  assert.deepEqual(slugs("women"), ["tops", "accessories"]);
  assert.deepEqual(slugs("men"), [
    "new-arrivals",
    "tops",
    "bottoms",
    "accessories",
  ]);
  assert.deepEqual(slugs("new-arrivals"), ["men", "bottoms"]);
  assert.deepEqual(slugs("tops"), ["women", "men"]);
});

test("badges, types and navigation features come from category membership", () => {
  assert(isNew(catalog, shorts));
  assert(!isNew(catalog, tee));
  assert.equal(productType(catalog, cap)?.slug, "accessories");
  const featured = featuredProducts(catalog);
  assert.equal(featured.get("new-arrivals"), shorts);
  assert.equal(featured.get("women"), tee);
  assert.equal(featured.get("men"), cap);
});

test("related products exclude the product and respect its audience", () => {
  const related = relatedProducts(catalog, bra);
  assert(!related.includes(bra));
  assert(!related.includes(shorts), "Men-only shorts are not related to a bra");
  assert.equal(related[0], tee, "Same product type comes first");
  assert.equal(relatedProducts(catalog, tee).length, 3);
});

test("sorting uses the API's minor-unit prices and names", () => {
  const names = (sort: Parameters<typeof sortProducts>[1]) =>
    sortProducts(catalog.products, sort).map((item) => item.name);
  assert.deepEqual(names("featured"), [
    "The Heavyweight Tee",
    "Pace Training Shorts",
    "Form Sculpt Bra",
    "Run Club Cap",
  ]);
  assert.equal(names("price-low")[0], "Run Club Cap");
  assert.equal(names("price-high")[0], "Pace Training Shorts");
  assert.equal(names("name")[0], "Form Sculpt Bra");
});

test("option values are read from the variants in the merchant's order", () => {
  assert.deepEqual(optionValues(tee, colorOption), ["Washed black"]);
  assert.deepEqual(optionValues(tee, sizeOption), ["S", "M", "L"]);
  assert.deepEqual(optionValues(cap, sizeOption), ["One size"]);
  assert.deepEqual(optionValues(tee, /^material$/i), []);
});

test("the bag limit counts every line of the same variant", () => {
  const cart = {
    items: [
      { variantId: 100, quantity: 3 },
      { variantId: 101, quantity: 2 },
      { variantId: 100, quantity: 4 },
    ],
  } as Cart;
  assert.equal(quantityInCart(cart, 100), 7);
  assert.equal(quantityInCart(cart, 102), 0);
  assert.equal(quantityInCart(null, 100), 0);
  assert.equal(maxItemQuantity, 20);
});
