"use client"

import { useCart } from "@quickbutik/kit/react"
import Link from "next/link"
import { BagIcon } from "./icons"

export function CartBadge() {
  const { itemCount } = useCart()
  return (
    <Link href="/cart" className="cart-link" aria-label={`Cart, ${itemCount} items`}>
      <BagIcon />
      <span>Cart</span>
      {itemCount > 0 && <em className="cart-count">{itemCount}</em>}
    </Link>
  )
}
