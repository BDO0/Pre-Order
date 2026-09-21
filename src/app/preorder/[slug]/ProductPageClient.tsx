"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/cart";
import { SITE_NAME } from "@/lib/site";
import styles from "./campaign.module.css";

interface Variant {
  id: string;
  size: string | null;
  color: string | null;
  sku: string | null;
  priceOverride: number | null;
  capacity: number | null;
  remainingCapacity: number | null;
  active: boolean;
}

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  currency: string;
  images: string[];
  preorderStatus: string;
  preorderRemaining: number | null;
  variants: Variant[];
}

export interface Batch {
  id: string;
  name: string;
  slug: string;
  status: string;
  endAt: string | null;
}

export default function ProductPageClient({ product, batch }: { product: Product, batch: Batch }) {
  const { addItem, getItemCount, setBatch, batchId } = useCartStore();

  // Set batch in store on mount / when batch changes
  useEffect(() => {
    if (batchId !== batch.id) {
      setBatch(batch.id, batch.slug);
    }
  }, [batch.id, batch.slug, batchId, setBatch]);

  const isClosed = batch.status === "CLOSED" || product.preorderStatus === "CLOSED" || product.preorderStatus === "SOLD_OUT";
  const isOrderable = !isClosed && product.preorderStatus === "OPEN";
  const itemCount = getItemCount();

  const colors = [...new Set(product.variants.filter(v => v.color).map(v => v.color!))];
  const sizes = [...new Set(product.variants.filter(v => v.size).map(v => v.size!))];

  const [selectedColor, setSelectedColor] = useState<string | null>(colors[0] ?? null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const selectedVariant = product.variants.find(
    v => (colors.length === 0 || v.color === selectedColor) &&
         (sizes.length === 0 || v.size === selectedSize)
  ) ?? (colors.length === 0 && sizes.length === 0 ? product.variants[0] : null);

  const isVariantAvailable = (color: string | null, size: string | null) => {
    const v = product.variants.find(
      v => (colors.length === 0 || v.color === color) &&
           (sizes.length === 0 || v.size === size)
    );
    if (!v || !v.active) return false;
    if (v.remainingCapacity !== null && v.remainingCapacity <= 0) return false;
    return true;
  };

  const canAdd = isOrderable && selectedVariant && selectedVariant.active &&
    (selectedVariant.remainingCapacity === null || selectedVariant.remainingCapacity >= qty);

  const handleAdd = () => {
    if (!selectedVariant || !canAdd) return;
    addItem(
      { id: product.id, name: product.name, images: product.images, price: product.price },
      selectedVariant,
      qty,
      batch.id,
      batch.slug
    );
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  const effectivePrice = selectedVariant?.priceOverride
    ? Number(selectedVariant.priceOverride)
    : Number(product.price);

  return (
    <div className={styles.page}>
      {/* Navbar */}
      <nav className="navbar">
        <div className={`container navbar-inner`}>
          <Link href="/" className="navbar-brand">{SITE_NAME}</Link>
          <Link href="/cart" className={styles.cartButton} id="cart-link">
            <span>🛒</span>
            {itemCount > 0 && <span className={styles.cartBadge}>{itemCount}</span>}
            <span className="hide-mobile">Cart</span>
          </Link>
        </div>
      </nav>

      {/* Main Content */}
      <main className="container" style={{ paddingBlock: "var(--space-8)" }}>
        <Link href="/" className="btn btn-ghost btn-sm" style={{ marginBottom: "var(--space-4)", display: "inline-block" }}>
          ← Back to Catalogue
        </Link>
        
        <div style={{ display: "flex", gap: "var(--space-8)", flexWrap: "wrap" }}>
          {/* Product Image */}
          <div style={{ flex: "1 1 400px" }}>
            <div style={{ aspectRatio: "3/4", background: "var(--color-neutral-100)", borderRadius: "var(--radius-xl)", overflow: "hidden" }}>
              {product.images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.images[0]} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: "4rem" }}>👗</div>
              )}
            </div>
          </div>

          {/* Product Details & Form */}
          <div style={{ flex: "1 1 400px" }}>
            <div style={{ marginBottom: "var(--space-6)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
                <span className="badge" style={{ background: "var(--color-neutral-200)", color: "var(--color-neutral-700)" }}>
                  {batch.name}
                </span>
                {batch.status === "CLOSED" && <span className="badge badge-closed">Batch Closed</span>}
              </div>
              <h1 style={{ fontSize: "var(--text-3xl)", fontWeight: 800, marginBottom: "var(--space-2)" }}>{product.name}</h1>
              <p style={{ fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--color-brand-600)" }}>
                ₱{effectivePrice.toLocaleString()}
              </p>
            </div>

            {product.description && (
              <p style={{ fontSize: "var(--text-base)", color: "var(--color-neutral-600)", marginBottom: "var(--space-8)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {product.description}
              </p>
            )}

            {!isOrderable ? (
              <div style={{ padding: "var(--space-6)", background: "var(--color-neutral-50)", borderRadius: "var(--radius-lg)", textAlign: "center" }}>
                <p style={{ fontSize: "var(--text-lg)", fontWeight: 600, color: "var(--color-neutral-500)" }}>
                  {product.preorderStatus === "COMING_SOON" ? "Coming Soon" : "Currently Unavailable"}
                </p>
              </div>
            ) : (
              <div style={{ padding: "var(--space-6)", background: "white", border: "1px solid var(--color-neutral-200)", borderRadius: "var(--radius-xl)", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.05)" }}>
                {colors.length > 0 && (
                  <div className="form-group" style={{ marginBottom: "var(--space-4)" }}>
                    <label className="form-label">Color</label>
                    <div className={styles.variantOptions}>
                      {colors.map(color => (
                        <button
                          key={color}
                          id={`color-${color.toLowerCase()}`}
                          className={`${styles.variantBtn} ${selectedColor === color ? styles.selected : ""}`}
                          onClick={() => { setSelectedColor(color); setSelectedSize(null); }}
                        >
                          {color}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {sizes.length > 0 && (
                  <div className="form-group" style={{ marginBottom: "var(--space-4)" }}>
                    <label className="form-label">Size</label>
                    <div className={styles.variantOptions}>
                      {sizes.map(size => {
                        const available = isVariantAvailable(selectedColor, size);
                        return (
                          <button
                            key={size}
                            id={`size-${size.toLowerCase()}`}
                            className={`${styles.variantBtn} ${selectedSize === size ? styles.selected : ""} ${!available ? styles.disabledVariant : ""}`}
                            onClick={() => available && setSelectedSize(size)}
                            disabled={!available}
                            aria-disabled={!available}
                          >
                            {size}
                            {!available && <span className={styles.soldOutX}>✗</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="form-group" style={{ marginBottom: "var(--space-6)" }}>
                  <label className="form-label">Quantity</label>
                  <div className={styles.qtyControl}>
                    <button className={styles.qtyBtn} onClick={() => setQty(q => Math.max(1, q - 1))} aria-label="Decrease quantity">−</button>
                    <span className={styles.qtyValue}>{qty}</span>
                    <button
                      className={styles.qtyBtn}
                      onClick={() => {
                        const max = selectedVariant?.remainingCapacity ?? 99;
                        setQty(q => Math.min(max, q + 1));
                      }}
                      aria-label="Increase quantity"
                    >+</button>
                  </div>
                </div>

                <button
                  id="confirm-add-to-order"
                  className={`btn btn-primary btn-full btn-lg ${added ? styles.addedBtn : ""}`}
                  onClick={handleAdd}
                  disabled={!canAdd || added}
                >
                  {added ? "✓ Added to Order!" : `Add to Order — ₱${(effectivePrice * qty).toLocaleString()}`}
                </button>
                
                {product.preorderRemaining !== null && (
                  <p style={{ textAlign: "center", marginTop: "var(--space-3)", fontSize: "var(--text-sm)", color: "var(--color-brand-600)", fontWeight: 500 }}>
                    Only {product.preorderRemaining} slots left in this batch!
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Floating cart button on mobile */}
      {itemCount > 0 && (
        <div className={styles.floatingCart}>
          <Link href="/cart" className="btn btn-primary btn-lg">
            View Order ({itemCount} item{itemCount !== 1 ? "s" : ""}) →
          </Link>
        </div>
      )}
    </div>
  );
}
