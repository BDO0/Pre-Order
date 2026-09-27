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
  setBatch: (id: string, slug: string) => void;
  addItem: (
    product: CartProduct,
    variant: CartVariant,
    quantity: number,
    batchId: string,
    batchSlug: string
  ) => void;
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
      setBatch: (id, slug) =>
        set({ batchId: id, batchSlug: slug }),
      addItem: (product, variant, quantity, batchId, batchSlug) => {
        const state = get();
        const items = state.batchId === batchId ? state.items : [];
        if (state.batchId !== batchId) {
          set({ batchId, batchSlug, items: [] });
        }
        const existing = items.find((i) => i.variantId === variant.id);
        if (existing) {
          set({
            items: items.map((i) =>
              i.variantId === variant.id
                ? { ...i, quantity: i.quantity + quantity }
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
      },
      updateQuantity: (cartItemId, quantity) => {
        if (quantity < 1) {
          get().removeItem(cartItemId);
          return;
        }
        set({
          items: get().items.map((i) =>
            i.id === cartItemId ? { ...i, quantity } : i
          ),
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
