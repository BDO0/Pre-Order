"use client";

import { useCartStore } from "@/store/cart";
import Link from "next/link";
import styles from "./cart.module.css";

export default function CartPage() {
  const { items, updateQuantity, removeItem, clearCart, getSubtotal, batchSlug } = useCartStore();

  // No delivery fee is added here, because none is charged: the order service
  // computes `total = subtotal` and shipping is arranged — and settled — in
  // Instagram DM. The heading above the total is what tells the customer that,
  // so the number shown is the number they are asked to pay.
  const subtotal = getSubtotal();
  const total = subtotal;

  if (items.length === 0) {
    return (
      <div className={styles.page}>
        <nav className="navbar">
          <div className="container navbar-inner">
            <Link href="/" className="navbar-brand">ANA Clothing</Link>
          </div>
        </nav>
        <div className="container" style={{ paddingBlock: "var(--space-16)" }}>
          <div className="empty-state">
            <div className="empty-state-icon">🛒</div>
            <p className="empty-state-title">Your cart is empty</p>
            <p className="empty-state-text">Add products from a drop to get started.</p>
            {batchSlug && (
              <Link href={`/`} className="btn btn-primary" style={{ marginTop: "var(--space-4)" }}>
                Continue Shopping
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <nav className="navbar">
        <div className="container navbar-inner">
          <Link href="/" className="navbar-brand">ANA Clothing</Link>
          {batchSlug && (
            <Link href={`/`} className="btn btn-ghost btn-sm">
              ← Continue Shopping
            </Link>
          )}
        </div>
      </nav>

      <main className="container" style={{ paddingBlock: "var(--space-8)" }}>
        <h1 className="page-title" style={{ textAlign: "left", paddingBlock: 0, marginBottom: "var(--space-6)" }}>
          Your Order
        </h1>

        <div className={styles.layout}>
          {/* Items */}
          <div className={styles.items}>
            {items.map((item) => (
              <div key={item.id} className={styles.item}>
                <div className={styles.itemImage}>
                  {item.product.images[0]
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={item.product.images[0]} alt={item.product.name} />
                    : <span>👗</span>
                  }
                </div>
                <div className={styles.itemInfo}>
                  <p className={styles.itemName}>{item.product.name}</p>
                  <p className={styles.itemVariant}>
                    {[item.variant.color, item.variant.size].filter(Boolean).join(" / ")}
                  </p>
                  <p className={styles.itemPrice}>
                    ₱{(item.unitPrice * item.quantity).toLocaleString()}
                  </p>
                </div>
                <div className={styles.itemActions}>
                  <div className={styles.qtyControl}>
                    <button
                      className={styles.qtyBtn}
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      aria-label="Decrease"
                    >−</button>
                    <span className={styles.qtyValue}>{item.quantity}</span>
                    <button
                      className={styles.qtyBtn}
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      aria-label="Increase"
                    >+</button>
                  </div>
                  <button
                    className={styles.removeBtn}
                    onClick={() => removeItem(item.id)}
                    aria-label={`Remove ${item.product.name}`}
                  >Remove</button>
                </div>
              </div>
            ))}

            <button className="btn btn-ghost btn-sm" onClick={clearCart} style={{ marginTop: "var(--space-2)" }}>
              Clear Order
            </button>
          </div>

          {/* Summary */}
          <div className={styles.summary}>
            <div className={styles.summaryCard}>
              <h2 className={styles.summaryTitle}>Order Summary</h2>
              <div className={styles.summaryRow}>
                <span>Subtotal</span>
                <span>₱{subtotal.toLocaleString()}</span>
              </div>
              <div className={styles.summaryRow}>
                <span>Shipping</span>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-600)" }}>Settled via Instagram DM</span>
              </div>
              <div className={`${styles.summaryRow} ${styles.summaryTotal}`}>
                <span>Total</span>
                <span>₱{total.toLocaleString()}</span>
              </div>
              <Link href="/checkout" id="proceed-to-checkout" className="btn btn-primary btn-full btn-lg" style={{ marginTop: "var(--space-5)" }}>
                Proceed to Checkout →
              </Link>
              <p className={styles.summaryNote}>
                ✓ Final price will be verified at checkout
              </p>
              <p className={styles.summaryNote}>
                We&apos;ll confirm shipping and payment with you on Instagram.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
