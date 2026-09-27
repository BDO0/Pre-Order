"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/cart";
import { SITE_NAME, SHOP_INSTAGRAM_HANDLE, SHOP_INSTAGRAM_URL } from "@/lib/site";
import { CustomBagIcon, GarmentSilhouette } from "@/components/CustomerIcons";
import { BrandLogo } from "@/components/BrandLogo";
import glass from "@/app/glass.module.css";
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
export default function ProductPageClient({ product, batch }: { product: Product; batch: Batch }) {
  const { addItem, getItemCount, setBatch, batchId } = useCartStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    if (batchId !== batch.id) {
      setBatch(batch.id, batch.slug);
    }
  }, [batch.id, batch.slug, batchId, setBatch]);
  const isClosed = batch.status === "CLOSED" || product.preorderStatus === "CLOSED" || product.preorderStatus === "SOLD_OUT";
  const isOrderable = !isClosed && product.preorderStatus === "OPEN";
  const itemCount = mounted ? getItemCount() : 0;
  const colors = [...new Set(product.variants.filter((v) => v.color).map((v) => v.color!))];
  const sizes = [...new Set(product.variants.filter((v) => v.size).map((v) => v.size!))];
  const [selectedColor, setSelectedColor] = useState<string | null>(colors[0] ?? null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const selectedVariant =
    (sizes.length > 0 && !selectedSize) || (colors.length > 0 && !selectedColor)
      ? null
      : product.variants.find(
          (v) =>
            (colors.length === 0 || v.color === selectedColor) &&
            (sizes.length === 0 || v.size === selectedSize)
        ) ?? (colors.length === 0 && sizes.length === 0 ? product.variants[0] : null);
  const isVariantAvailable = (color: string | null, size: string | null) => {
    const v = product.variants.find(
      (v) =>
        (colors.length === 0 || v.color === color) &&
        (sizes.length === 0 || v.size === size)
    );
    if (!v || !v.active) return false;
    if (v.remainingCapacity !== null && v.remainingCapacity <= 0) return false;
    return true;
  };
  const canAdd =
    isOrderable &&
    Boolean(selectedVariant) &&
    Boolean(selectedVariant?.active) &&
    (selectedVariant?.remainingCapacity === null || (selectedVariant?.remainingCapacity ?? 0) >= qty);
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
    <div className={`${glass.glassPage} ${styles.page}`}>
      <div className={glass.bg} />
      <div className={glass.orb1} />
      <div className={glass.orb2} />
      <div className={glass.orb3} />
      <div className={glass.content}>
        <nav className={glass.nav}>
          <div className={glass.navInner}>
            <Link href="/" className={glass.navBrand} aria-label={SITE_NAME}>
              <BrandLogo variant="horizontal" height={34} />
            </Link>
            <div className={glass.navActions}>
              <Link href="/" className={glass.navGhostBtn} aria-label="Back to Shop">
                ← <span className={glass.mobileHideText}>Back to </span>Shop
              </Link>
              <Link href="/cart" className={glass.navCartBtn} id="cart-link" aria-label="View Cart">
                <CustomBagIcon size={16} />
                <span>Cart</span>
                {itemCount > 0 && (
                  <span
                    style={{
                      background: "rgba(255, 255, 255, 0.25)",
                      color: "white",
                      borderRadius: "9999px",
                      padding: "2px 7px",
                      fontSize: "11px",
                      fontWeight: 800,
                      marginLeft: "4px",
                    }}
                  >
                    {itemCount}
                  </span>
                )}
              </Link>
            </div>
          </div>
        </nav>
        <main className={styles.mainContent}>
          <Link href="/" className={styles.backLink}>
            ← Back to Catalogue
          </Link>
          <div className={styles.productGrid}>
            <div className={styles.imageCard}>
              <div className={styles.imageWrap}>
                {product.images[0] ? (
                  <img
                    src={product.images[0]}
                    alt={product.name}
                    className={styles.productImg}
                  />
                ) : (
                  <div className={styles.placeholderArt}>
                    <GarmentSilhouette category={product.name} name={product.name} size={64} />
                  </div>
                )}
              </div>
            </div>
            <div className={styles.infoCol}>
              <div>
                <div className={styles.badgeRow} style={{ marginBottom: "var(--space-3)" }}>
                  <span className={styles.batchBadge}>{batch.name}</span>
                  {batch.status === "CLOSED" && (
                    <span className="badge badge-closed">Batch Closed</span>
                  )}
                  {product.preorderStatus === "SOLD_OUT" && (
                    <span className="badge badge-closed">Sold Out</span>
                  )}
                </div>
                <h1 className={styles.productTitle}>{product.name}</h1>
                <p className={styles.productPrice}>
                  ₱{effectivePrice.toLocaleString()}
                </p>
              </div>
              {product.description && (
                <p className={styles.productDesc}>{product.description}</p>
              )}
              {!isOrderable ? (
                <div
                  className={styles.formCard}
                  style={{ textAlign: "center", padding: "var(--space-8)" }}
                >
                  <p style={{ fontSize: "var(--text-lg)", fontWeight: 600, color: "rgba(255, 255, 255, 0.9)" }}>
                    {product.preorderStatus === "COMING_SOON"
                      ? "Coming Soon"
                      : "Currently Unavailable"}
                  </p>
                </div>
              ) : (
                <div className={styles.formCard}>
                  {colors.length > 0 && (
                    <div>
                      <div className={styles.fieldLabel}>
                        <span>Select Color</span>
                        <span style={{ color: "rgba(255, 255, 255, 0.95)", fontWeight: 600 }}>{selectedColor ?? "None"}</span>
                      </div>
                      <div className={styles.variantOptions}>
                        {colors.map((color) => (
                          <button
                            key={color}
                            id={`color-${color.toLowerCase()}`}
                            className={`${styles.variantBtn} ${
                              selectedColor === color ? styles.selected : ""
                            }`}
                            onClick={() => {
                              setSelectedColor(color);
                              setSelectedSize(null);
                            }}
                          >
                            {color}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {sizes.length > 0 && (
                    <div>
                      <div className={styles.fieldLabel}>
                        <span>Select Size</span>
                        <span style={{ color: selectedSize ? "rgba(255, 255, 255, 0.95)" : "#ff80a0", fontWeight: 600 }}>
                          {selectedSize ?? "Please select a size"}
                        </span>
                      </div>
                      <div className={styles.variantOptions}>
                        {sizes.map((size) => {
                          const available = isVariantAvailable(selectedColor, size);
                          return (
                            <button
                              key={size}
                              id={`size-${size.toLowerCase()}`}
                              className={`${styles.variantBtn} ${
                                selectedSize === size ? styles.selected : ""
                              } ${!available ? styles.disabledVariant : ""}`}
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
                  <div>
                    <div className={styles.fieldLabel}>
                      <span>Quantity</span>
                    </div>
                    <div className={styles.qtyControl}>
                      <button
                        className={styles.qtyBtn}
                        onClick={() => setQty((q) => Math.max(1, q - 1))}
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span className={styles.qtyValue}>{qty}</span>
                      <button
                        className={styles.qtyBtn}
                        onClick={() => {
                          const max = selectedVariant?.remainingCapacity ?? 99;
                          setQty((q) => Math.min(max, q + 1));
                        }}
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <button
                    id="confirm-add-to-order"
                    className={`${styles.submitBtn} ${added ? styles.addedBtn : ""}`}
                    onClick={handleAdd}
                    disabled={!canAdd || added}
                  >
                    {added
                      ? "✓ Added to Order!"
                      : sizes.length > 0 && !selectedSize
                      ? "Select a Size to Pre-order"
                      : colors.length > 0 && !selectedColor
                      ? "Select a Color to Pre-order"
                      : `Add to Order — ₱${(effectivePrice * qty).toLocaleString()}`}
                  </button>
                  {product.preorderRemaining !== null && (
                    <p className={styles.remainingText}>
                      Only {product.preorderRemaining} slots left in this batch!
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
        <section style={{ maxWidth: "760px", margin: "var(--space-6) auto var(--space-16)", paddingInline: "var(--space-4)", position: "relative", zIndex: 1 }}>
          <div
            className={glass.glassCard}
            style={{
              padding: "var(--space-8) var(--space-6)",
              textAlign: "center",
            }}
          >
            <h2
              className={glass.pageTitleEditorial}
              style={{
                fontSize: "1.5rem",
                marginBottom: "var(--space-2)",
              }}
            >
              How pre-ordering works
            </h2>
            <p
              style={{
                fontSize: "var(--text-sm)",
                color: "rgba(255, 255, 255, 0.7)",
                maxWidth: "560px",
                margin: "0 auto var(--space-5)",
                lineHeight: 1.6,
              }}
            >
              Reserve your pieces here — no payment is taken on this site. We message you
              on Instagram to confirm sizing, shipping and payment, and your order is
              reserved the moment you place it.
            </p>
            <div
              style={{
                display: "flex",
                gap: "var(--space-4)",
                justifyContent: "center",
                flexWrap: "wrap",
                fontSize: "var(--text-xs)",
                color: "rgba(255, 255, 255, 0.8)",
                marginBottom: "var(--space-5)",
              }}
            >
              <span>✓ Limited, made-to-order pieces</span>
              <span>✓ Confirmed personally on Instagram</span>
              <span>✓ Your own private order link</span>
            </div>
            <a
              href={SHOP_INSTAGRAM_URL}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
              style={{ display: "inline-block" }}
            >
              Message us @{SHOP_INSTAGRAM_HANDLE}
            </a>
          </div>
        </section>
        {itemCount > 0 && (
          <div className={styles.floatingCart}>
            <Link href="/cart" className="btn btn-primary btn-lg btn-full">
              View Order ({itemCount} item{itemCount !== 1 ? "s" : ""}) →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
