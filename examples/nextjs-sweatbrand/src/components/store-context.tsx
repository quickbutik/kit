"use client";

import { createContext, useContext } from "react";
import type { Catalog } from "@/lib/catalog";

type StoreState = {
  catalog: Catalog;
  // Whether the request carried a customer session cookie: the first render's
  // guess, before the browser has read and checked the session itself.
  signedIn: boolean;
  favorites: string[];
  toggleFavorite: (id: string) => void;
  openBag: () => void;
  openInfo: (key: string) => void;
};

export const StoreContext = createContext<StoreState | null>(null);
export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error("Shopping state requires Storefront.");
  return context;
}
