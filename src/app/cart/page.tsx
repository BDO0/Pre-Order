"use client";
import { useState } from "react";
import { useCartStore } from "@/store/cart";
import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import { formatMoney } from "@/lib/format";
import { BrandLogo } from "@/components/BrandLogo";
import { CustomBagIcon, GarmentSilhouette } from "@/components/CustomerIcons";
import styles from "./cart.module.css";
import glass from "../glass.module.css";
export default function CartPage() {
  const { items, updateQuantity, removeItem, clearCart, getSubtotal, batchSlug } = useCartStore();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const subtotal = getSubtotal();
  const total = subtotal;
  if (items.length === 0) {
    return (
      <div className={`${glass.glassPage} ${styles.page}`}>
        <div className={glass.bg} aria-hidden="true" />
        <div className={glass.orb1} aria-hidden="true" />
        <div className={glass.orb2} aria-hidden="true" />
        <div className={glass.orb3} aria-hidden="true" />
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
              </div>
            </div>
          </nav>
          <main
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "var(--space-8) var(--space-4)",
            }}
          >
            <div
              className={glass.glassCard}
              style={{
                padding: "clamp(var(--space-6), 5vw, var(--space-10)) clamp(var(--space-4), 4vw, var(--space-8))",
                maxWidth: "460px",
                width: "100%",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "var(--space-3)",
              }}
            >
              <div
                style={{
                  width: "80px",
                  height: "80px",
                  borderRadius: "50%",
                  background: "radial-gradient(circle, rgba(168, 16, 56, 0.3) 0%, rgba(20, 2, 7, 0.7) 100%)",
                  border: "1px solid rgba(255, 200, 220, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "rgba(255, 255, 255, 0.9)",
                  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4), 0 0 20px rgba(220, 40, 85, 0.25)",
                  marginBottom: "var(--space-2)",
                }}
                aria-hidden="true"
              >
                <CustomBagIcon size={38} />
              </div>
              <h2
                className={glass.pageTitleEditorial}
                style={{ fontSize: "1.75rem", margin: 0 }}
              >
                Your Cart is Empty
              </h2>
              <p style={{ color: "rgba(255,255,255,0.65)", fontSize: "var(--text-sm)", margin: 0 }}>
                Explore our latest drop to find your style.
              </p>
              <Link
                href="/"
                className="btn btn-primary btn-lg"
                style={{
                  marginTop: "var(--space-5)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                }}
              >
                ← Back to Shop
              </Link>
            </div>
          </main>
        </div>
      </div>
    );
  }
  return (
    <div className={`${glass.glassPage} ${styles.page}`}>
      <div className={glass.bg} aria-hidden="true" />
      <div className={glass.orb1} aria-hidden="true" />
      <div className={glass.orb2} aria-hidden="true" />
      <div className={glass.orb3} aria-hidden="true" />
      <div className={glass.content}>
        <nav className={glass.nav}>
          <div className={glass.navInner}>
            <Link href="/" className={glass.navBrand} aria-label={SITE_NAME}>
              <BrandLogo variant="horizontal" height={34} />
            </Link>
            <div className={glass.navActions}>
              <Link
                href="/"
                className={glass.navGhostBtn}
                aria-label="Back to Shop"
              >
                ← <span className={glass.mobileHideText}>Back to </span>Shop
              </Link>
            </div>
          </div>
        </nav>
        <main
          style={{
            flex: 1,
            maxWidth: "var(--max-w-4xl)",
            margin: "0 auto",
            width: "100%",
            padding: "var(--space-8) var(--space-6)",
          }}
        >
          <h1
            className={glass.pageTitleEditorial}
            style={{
              fontSize: "clamp(2rem, 4vw, 2.75rem)",
              textAlign: "left",
              marginBottom: "var(--space-6)",
            }}
          >
            Your Cart
          </h1>
          <div className={styles.layout}>
            <div className={styles.items}>
              {items.map((item) => (
                <div key={item.id} className={styles.item}>
                  <div className={styles.itemImage}>
                    {item.product.images[0] ? (
                      <img src={item.product.images[0]} loading="lazy" decoding="async" alt={item.product.name} />
                    ) : (
                      <GarmentSilhouette category={item.product.name} name={item.product.name} size={32} />
                    )}
                  </div>
                  <div className={styles.itemInfo}>
                    <p className={styles.itemName}>{item.product.name}</p>
                    <p className={styles.itemVariant}>
                      {[item.variant.color, item.variant.size].filter(Boolean).join(" • ")}
                    </p>
                    <p className={styles.itemPrice}>
                      {formatMoney(item.unitPrice * item.quantity)}
                    </p>
                  </div>
                  <div className={styles.itemActions}>
                    <div className={styles.qtyControl}>
                      <button
                        className={styles.qtyBtn}
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        aria-label="Decrease"
                      >
                        −
                      </button>
                      <span className={styles.qtyValue}>{item.quantity}</span>
                      <button
                        className={styles.qtyBtn}
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        aria-label="Increase"
                      >
                        +
                      </button>
                    </div>
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeItem(item.id)}
                      aria-label={`Remove ${item.product.name}`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowClearConfirm(true)}
                style={{ marginTop: "var(--space-2)" }}
              >
                Clear Cart
              </button>
            </div>
            <div className={styles.summary}>
              <div className={styles.summaryCard}>
                <h2 className={styles.summaryTitle}>Order Summary</h2>
                <div className={styles.summaryRow}>
                  <span>Subtotal</span>
                  <span style={{ fontWeight: 600, color: "#fff" }}>{formatMoney(subtotal)}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Shipping</span>
                  <span style={{ fontSize: "var(--text-xs)", color: "rgba(255,255,255,.55)" }}>
                    Settled via Instagram DM
                  </span>
                </div>
                <div className={`${styles.summaryRow} ${styles.summaryTotal}`}>
                  <span>Total</span>
                  <span>{formatMoney(total)}</span>
                </div>
                <Link
                  href="/checkout"
                  id="proceed-to-checkout"
                  className="btn btn-primary btn-full btn-lg"
                  style={{ marginTop: "var(--space-5)" }}
                >
                  Proceed to Checkout →
                </Link>
                <Link
                  href="/"
                  className="btn btn-secondary btn-full"
                  style={{
                    marginTop: "var(--space-3)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "var(--space-1)",
                  }}
                >
                  ← Continue Shopping
                </Link>
                <p className={styles.summaryNote}>
                  No upfront payment · Confirmed via Instagram DM
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
      {showClearConfirm && (
        <div className={glass.glassPage} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", alignItems: "center", justifyContent: "center", zIndex: 100, display: "flex" }}>
          <div style={{ background: "rgba(255, 255, 255, 0.08)", backdropFilter: "blur(32px) saturate(200%)", borderRadius: "var(--radius-2xl)", border: "1px solid rgba(255, 255, 255, 0.16)", padding: "var(--space-6)", maxWidth: "400px", margin: "var(--space-4)", textAlign: "center", zIndex: 101 }}>
            <h3 style={{ marginBottom: "var(--space-4)", fontSize: "1.25rem", fontWeight: 700, color: "#fff" }}>Clear your cart?</h3>
            <p style={{ marginBottom: "var(--space-6)", color: "rgba(255,255,255,0.8)" }}>Are you sure you want to remove all items from your cart?</p>
            <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "center" }}>
              <button className="btn btn-ghost" onClick={() => setShowClearConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { clearCart(); setShowClearConfirm(false); }}>Clear Cart</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
