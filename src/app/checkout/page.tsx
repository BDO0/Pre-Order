"use client";

import { useState, useEffect } from "react";
import { useCartStore } from "@/store/cart";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { INSTAGRAM_HANDLE_HINT } from "@/lib/instagram";
import { SHOP_INSTAGRAM_HANDLE } from "@/lib/site";
import styles from "./checkout.module.css";

export default function CheckoutPage() {
  const router = useRouter();
  const { items, getSubtotal, clearCart, batchId } = useCartStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");
  
  // State for confirmation modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  useEffect(() => {
    if (items.length === 0) {
      router.push("/cart");
    }
  }, [items, router]);

  const subtotal = getSubtotal();

  const handlePreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !instagramHandle.trim()) {
      setError("Please fill in all required details.");
      return;
    }
    setError(null);
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      const orderPayload = {
        idempotencyKey: crypto.randomUUID(),
        batchId: batchId,
        items: items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        })),
        customerInfo: {
          fullName,
          instagramHandle,
        },
      };

      const orderRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload),
      });

      const orderJson = await orderRes.json();

      if (!orderRes.ok) {
        throw new Error(
          orderJson.error?.message ||
          "We could not place your order. Please try again."
        );
      }

      clearCart();
      setShowConfirmModal(false);

      // Only carry the token when there is one. `URLSearchParams` writes the
      // literal string "undefined" for an absent value, which turned the link
      // on the very next screen into `/order-status?token=undefined` — a broken
      // link that looked like a bug rather than like an untracked order.
      const params = new URLSearchParams({ ref: orderJson.data.reference });
      if (typeof orderJson.data.accessToken === "string" && orderJson.data.accessToken) {
        params.set("token", orderJson.data.accessToken);
      }
      router.push(`/order-success?${params.toString()}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
      setShowConfirmModal(false);
    } finally {
      setLoading(false);
    }
  };

  if (items.length === 0) return null;

  return (
    <div className={styles.page}>
      <nav className="navbar">
        <div className="container navbar-inner">
          <Link href="/" className="navbar-brand">ANA Clothing</Link>
          <Link href="/cart" className="btn btn-ghost btn-sm">← Back to Cart</Link>
        </div>
      </nav>

      <main className="container" style={{ paddingBlock: "var(--space-8)" }}>
        <h1 className="page-title" style={{ textAlign: "left", marginBottom: "var(--space-6)" }}>
          Checkout
        </h1>

        <form onSubmit={handlePreSubmit} className={styles.layout}>
          <div className={styles.formSections}>
            {/* Identity */}
            <section className={styles.sectionCard}>
              <h2 className={styles.sectionTitle}>1. Who are you?</h2>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", marginBottom: "var(--space-5)" }}>
                Two details is all we need. We&apos;ll message you on Instagram to sort out
                sizing, payment and delivery.
              </p>
              <div className={styles.grid}>
                <div className="form-group">
                  <label className="form-label form-label-required">Full Name</label>
                  <input
                    required
                    name="fullName"
                    className="form-input"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Juan dela Cruz"
                    autoComplete="name"
                    maxLength={120}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label form-label-required">Instagram Username</label>
                  <input
                    required
                    name="instagramHandle"
                    className="form-input"
                    value={instagramHandle}
                    onChange={(e) => setInstagramHandle(e.target.value)}
                    placeholder="@juandc"
                    autoComplete="username"
                    maxLength={60}
                  />
                  <span className="form-hint">{INSTAGRAM_HANDLE_HINT}</span>
                </div>
              </div>
            </section>

            <section className={styles.sectionCard}>
              <h2 className={styles.sectionTitle}>2. Payment &amp; shipping</h2>
              <div className={styles.paymentInstructions}>
                <p>
                  <strong>Everything is settled on Instagram.</strong>
                </p>
                <p style={{ marginTop: "var(--space-2)" }}>
                  Message us at <strong>@{SHOP_INSTAGRAM_HANDLE}</strong> (or reply to our DM) to arrange
                  payment and delivery. Your order is only reserved once we have confirmed it
                  with you, and your order number is on the next screen.
                </p>
              </div>

              {error && (
                <div style={{ padding: "var(--space-3) var(--space-4)", background: "rgb(220 38 38 / 0.08)", border: "1px solid rgb(220 38 38 / 0.3)", borderRadius: "var(--radius-lg)", color: "var(--color-error)", fontWeight: 500, marginTop: "var(--space-4)" }}>
                  ⚠ {error}
                </div>
              )}
            </section>
          </div>

          {/* Order Summary */}
          <div className={styles.summarySidebar}>
            <div className={styles.summaryCard}>
              <h2 className={styles.sectionTitle}>Order Summary</h2>
              <div className={styles.itemsList}>
                {items.map((item) => (
                  <div key={item.id} className={styles.summaryItem}>
                    <div className={styles.summaryItemQty}>{item.quantity}×</div>
                    <div className={styles.summaryItemName}>
                      {item.product.name}
                      <span className={styles.summaryItemVariant}>
                        {[item.variant.color, item.variant.size].filter(Boolean).join(" / ")}
                      </span>
                    </div>
                    <div className={styles.summaryItemPrice}>
                      ₱{(item.unitPrice * item.quantity).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
              <div className={styles.summaryTotals}>
                <div className={`${styles.summaryRow} ${styles.summaryGrandTotal}`}>
                  <span>Total</span><span>₱{subtotal.toLocaleString()}</span>
                </div>
              </div>
              <button type="submit" disabled={loading}
                className="btn btn-primary btn-full btn-lg" style={{ marginTop: "var(--space-5)" }}>
                Place Pre-Order
              </button>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", marginTop: "var(--space-3)", textAlign: "center" }}>
                No payment is taken now.
              </p>
            </div>
          </div>
        </form>

        {/* Confirmation Modal */}
        {showConfirmModal && (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000,
            padding: "var(--space-4)"
          }}>
            <div style={{
              background: "white", padding: "var(--space-6)", borderRadius: "var(--radius-xl)",
              maxWidth: "500px", width: "100%", boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1)"
            }}>
              <h2 style={{ fontSize: "var(--text-xl)", fontWeight: 700, marginBottom: "var(--space-4)", color: "var(--color-neutral-900)" }}>
                Confirm Your Pre-Order
              </h2>
              
              <div style={{ marginBottom: "var(--space-4)" }}>
                <h3 style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-neutral-500)", marginBottom: "var(--space-2)" }}>Your Details</h3>
                <p><strong>Name:</strong> {fullName}</p>
                <p><strong>Instagram:</strong> {instagramHandle}</p>
              </div>
              
              <div style={{ marginBottom: "var(--space-6)" }}>
                <h3 style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-neutral-500)", marginBottom: "var(--space-2)" }}>Your Order</h3>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, borderTop: "1px solid var(--color-neutral-100)", borderBottom: "1px solid var(--color-neutral-100)", paddingBlock: "var(--space-2)" }}>
                  {items.map((item) => (
                    <li key={item.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: "var(--space-2)", fontSize: "var(--text-sm)" }}>
                      <span>{item.quantity}× {item.product.name} ({[item.variant.color, item.variant.size].filter(Boolean).join("/")})</span>
                      <span style={{ fontWeight: 600 }}>₱{(item.unitPrice * item.quantity).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "var(--space-2)", fontWeight: 700, fontSize: "var(--text-lg)" }}>
                  <span>Total Due</span>
                  <span>₱{subtotal.toLocaleString()}</span>
                </div>
              </div>
              
              <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "flex-end" }}>
                <button 
                  onClick={() => setShowConfirmModal(false)}
                  className="btn btn-secondary"
                  disabled={loading}
                >
                  Edit Details
                </button>
                <button 
                  onClick={handleConfirmSubmit}
                  className="btn btn-primary"
                  disabled={loading}
                >
                  {loading ? "Confirming..." : "Confirm Pre-Order"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

