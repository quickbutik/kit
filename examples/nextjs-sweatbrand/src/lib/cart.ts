import type { Cart } from "@quickbutik/kit";

export const maxItemQuantity = 20;

// How many of one variant the bag already holds.
export function quantityInCart(cart: Cart | null, variantId: number) {
  return (
    cart?.items
      .filter((item) => item.variantId === variantId)
      .reduce((total, item) => total + item.quantity, 0) ?? 0
  );
}
