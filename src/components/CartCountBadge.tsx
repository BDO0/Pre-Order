"use client";
import { useSyncExternalStore } from "react";
import { useCartStore } from "@/store/cart";

/**
 * The number beside the cart pill.
 *
 * `useSyncExternalStore` rather than `useState` plus a mount effect: the third
 * argument is the server snapshot, so the server and the first client render
 * both report 0, hydration is clean, and React swaps in the real count on the
 * very next paint. Reading localStorage during render would guarantee a
 * mismatch instead, and a `mounted` flag would trip react-hooks/set-state-in-effect.
 *
 * It returns null at zero, so an empty cart looks exactly as it did before.
 */
export function CartCountBadge() {
  const count = useSyncExternalStore(
    (onStoreChange) => useCartStore.subscribe(onStoreChange),
    () => useCartStore.getState().getItemCount(),
    () => 0
  );

  if (count === 0) return null;

  return <span className="cart-count-badge">{count}</span>;
}
