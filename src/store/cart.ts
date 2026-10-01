import { create } from "zustand";
import { persist } from "zustand/middleware";
export interface CartVariant {
  id: string;
  size: string | null;
  color: string | null;
  sku: string | null;
  priceOverride: number | null;
  remainingCapacity: number | null;
}
export interface CartProduct {
  id: string;
  name: string;
  images: string[];
  price: number;
}
export interface CartItem {
  id: string; 
  variantId: string;
  product: CartProduct;
  variant: CartVariant;
  quantity: number;
  unitPrice: number; 
}
interface CartState {
  batchId: string | null;
  batchSlug: string | null;
  items: CartItem[];
  setBatch: (id: string, slug: string) => boolean;
  addItem: (
    product: CartProduct,
    variant: CartVariant,
    quantity: number,
    batchId: string,
    batchSlug: string
  ) => boolean;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  removeItem: (cartItemId: string) => void;
  clearCart: () => void;
  getSubtotal: () => number;
  getItemCount: () => number;
}
export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      batchId: null,
      batchSlug: null,
      items: [],
      setBatch: (id, slug) => {
        const state = get();
        if (state.batchId !== id && state.items.length > 0) {
          return false;
        }
        if (state.batchId !== id) {
          set({ batchId: id, batchSlug: slug });
        }
        return true;
      },
      addItem: (product, variant, quantity, batchId, batchSlug) => {
        const state = get();
        if (state.batchId && state.batchId !== batchId && state.items.length > 0) {
          return false;
        }
        let items = state.items;
        if (state.batchId !== batchId) {
          set({ batchId, batchSlug, items: [] });
          items = [];
        }
        const existing = items.find((i) => i.variantId === variant.id);
        if (existing) {
          const max = variant.remainingCapacity ?? Infinity;
          const newQuantity = Math.min(existing.quantity + quantity, max);
          set({
            items: items.map((i) =>
              i.variantId === variant.id
                ? { ...i, quantity: newQuantity }
                : i
            ),
          });
        } else {
          const unitPrice = variant.priceOverride ?? product.price;
          set({
            batchId, 
            batchSlug,
            items: [
              ...items,
              {
                id: `${variant.id}-${Date.now()}`,
                variantId: variant.id,
                product,
                variant,
                quantity,
                unitPrice,
              },
            ],
          });
        }
        return true;
      },
      updateQuantity: (cartItemId, quantity) => {
        if (quantity < 1) {
          get().removeItem(cartItemId);
          return;
        }
        set({
          items: get().items.map((i) => {
            if (i.id === cartItemId) {
              const max = i.variant.remainingCapacity ?? Infinity;
              return { ...i, quantity: Math.min(quantity, max) };
            }
            return i;
          }),
        });
      },
      removeItem: (cartItemId) => {
        set({ items: get().items.filter((i) => i.id !== cartItemId) });
      },
      clearCart: () => set({ items: [], batchId: null, batchSlug: null }),
      getSubtotal: () =>
        get().items.reduce(
          (sum, item) => sum + item.unitPrice * item.quantity,
          0
        ),
      getItemCount: () =>
        get().items.reduce((sum, item) => sum + item.quantity, 0),
    }),
    {
      name: "ana-preorder-cart", 
      partialize: (state) => ({
        batchId: state.batchId,
        batchSlug: state.batchSlug,
        items: state.items,
      }),
    }
  )
);
