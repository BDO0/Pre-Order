"use client";
import { useSyncExternalStore } from "react";
import { useCartStore } from "@/store/cart";

export function CartCountBadge() {
  const count = useSyncExternalStore(
    (onStoreChange) => useCartStore.subscribe(onStoreChange),
    () => useCartStore.getState().getItemCount(),
    () => 0
  );

  if (count === 0) return null;

  return <span className="cart-count-badge">{count}</span>;
}
