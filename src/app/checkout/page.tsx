"use client";

import { useState, useEffect } from "react";
import { useCartStore } from "@/store/cart";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { computeShippingFee, type DeliveryType } from "@/lib/pricing";
import { useStoreSettings } from "@/hooks/use-store-settings";
import styles from "./checkout.module.css";

interface PaymentMethod {
  id: string;
  name: string;
  instructions: string | null;
  accountName: string | null;
  accountNumber: string | null;
  requiresProof: boolean;
}

export default function CheckoutPage() {
  const router = useRouter();
  const { items, campaignId, getSubtotal, clearCart } = useCartStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  const [formData, setFormData] = useState({
    fullName: "",
    mobileNumber: "",
    email: "",
    instagramHandle: "",
    deliveryType: "DELIVERY",
    address: "",
    city: "",
    province: "",
    paymentMethodId: "",
  });

  const [proofFile, setProofFile] = useState<File | null>(null);

  // Fetch real payment methods from DB
  useEffect(() => {
    fetch("/api/payment-methods")
      .then(r => r.json())
      .then(json => {
        const methods: PaymentMethod[] = json.data ?? [];
        setPaymentMethods(methods);
        if (methods.length > 0) {
          setFormData(prev => ({ ...prev, paymentMethodId: methods[0].id }));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (items.length === 0) {
      router.push("/cart");
    }
  }, [items, router]);

  const { shippingFee } = useStoreSettings();

  const subtotal = getSubtotal();
  // Pickup is free; delivery uses the operator-configured fee, published by
  // /api/settings/public. The server recomputes this from the same setting when
  // the order is created, so the browser can never negotiate its own total.
  const shipping = computeShippingFee({
    deliveryType: formData.deliveryType as DeliveryType,
    settings: { shippingFee },
  });
  const total = subtotal + shipping;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setProofFile(e.target.files[0]);
    }
  };

  const selectedPaymentMethod = paymentMethods.find(pm => pm.id === formData.paymentMethodId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let paymentProofKey: string | undefined = undefined;

      // 1. Upload proof if required
      if (selectedPaymentMethod?.requiresProof) {
        if (!proofFile) {
          throw new Error("Payment proof screenshot is required for this payment method.");
        }
        const uploadData = new FormData();
        uploadData.append("file", proofFile);
        // Marks this as customer PII: the upload route stores it outside the
        // public directory and re-encodes it, and accepts it without a session
        // because a shopper is not logged in.
        uploadData.append("purpose", "PAYMENT_PROOF");
        const uploadRes = await fetch("/api/upload", { method: "POST", body: uploadData });
        const uploadJson = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadJson.error?.message || "Failed to upload payment proof.");
        paymentProofKey = uploadJson.data.key;
      }

      // 2. Submit order — field names MUST match orderSubmissionSchema exactly
      const orderPayload = {
        idempotencyKey: crypto.randomUUID(), // required by schema
        campaignId,
        paymentMethodId: formData.paymentMethodId,
        paymentProofKey,
        items: items.map(item => ({
          variantId: item.variantId,
          quantity: item.quantity,
        })),
        customerInfo: {
          fullName: formData.fullName,
          mobileNumber: formData.mobileNumber,
          email: formData.email || undefined,
          instagramHandle: formData.instagramHandle || undefined,
        },
        // deliveryInfo must match the discriminatedUnion in validation.ts
        deliveryInfo: formData.deliveryType === "DELIVERY"
          ? {
              type: "DELIVERY" as const,
              recipientName: formData.fullName,    // use customer name as recipient
              phoneNumber: formData.mobileNumber,  // use customer phone as delivery phone
              address: formData.address,
              city: formData.city,
              province: formData.province,
              postalCode: undefined,
              additionalInstructions: undefined,
            }
          : {
              type: "PICKUP" as const,
              pickupNote: undefined,
            },
      };

      const orderRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload),
      });

      const orderJson = await orderRes.json();

      if (!orderRes.ok) {
        throw new Error(orderJson.error?.message || "Failed to create order. Please try again.");
      }

      clearCart();
      router.push(`/order-success?ref=${orderJson.data.reference}`);
    } catch (err: any) {
      setError(err.message);
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

        <form onSubmit={handleSubmit} className={styles.layout}>
          <div className={styles.formSections}>
            {/* Customer Info */}
            <section className={styles.sectionCard}>
              <h2 className={styles.sectionTitle}>1. Your Details</h2>
              <div className={styles.grid}>
                <div className="form-group">
                  <label className="form-label form-label-required">Full Name</label>
                  <input required name="fullName" className="form-input" value={formData.fullName}
                    onChange={handleInputChange} placeholder="Juan dela Cruz" />
                </div>
                <div className="form-group">
                  <label className="form-label form-label-required">Mobile Number</label>
                  <input required name="mobileNumber" className="form-input" value={formData.mobileNumber}
                    onChange={handleInputChange} placeholder="09XXXXXXXXX" />
                </div>
                <div className="form-group">
                  <label className="form-label">Email (Optional)</label>
                  <input type="email" name="email" className="form-input" value={formData.email}
                    onChange={handleInputChange} placeholder="juan@example.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">Instagram (Optional)</label>
                  <input name="instagramHandle" className="form-input" value={formData.instagramHandle}
                    onChange={handleInputChange} placeholder="@juandc" />
                </div>
              </div>
            </section>

            {/* Delivery */}
            <section className={styles.sectionCard}>
              <h2 className={styles.sectionTitle}>2. Delivery Method</h2>
              <div className={styles.radioGroup}>
                <label className={styles.radioLabel}>
                  <input type="radio" name="deliveryType" value="DELIVERY"
                    checked={formData.deliveryType === "DELIVERY"} onChange={handleInputChange} />
                  Standard Delivery (₱{shippingFee})
                </label>
                <label className={styles.radioLabel}>
                  <input type="radio" name="deliveryType" value="PICKUP"
                    checked={formData.deliveryType === "PICKUP"} onChange={handleInputChange} />
                  Store Pickup (Free)
                </label>
              </div>

              {formData.deliveryType === "DELIVERY" && (
                <div className={styles.grid} style={{ marginTop: "var(--space-4)" }}>
                  <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                    <label className="form-label form-label-required">Street Address</label>
                    <input required name="address" className="form-input" value={formData.address} onChange={handleInputChange} />
                  </div>
                  <div className="form-group">
                    <label className="form-label form-label-required">City</label>
                    <input required name="city" className="form-input" value={formData.city} onChange={handleInputChange} />
                  </div>
                  <div className="form-group">
                    <label className="form-label form-label-required">Province</label>
                    <input required name="province" className="form-input" value={formData.province} onChange={handleInputChange} />
                  </div>
                </div>
              )}
            </section>

            {/* Payment */}
            <section className={styles.sectionCard}>
              <h2 className={styles.sectionTitle}>3. Payment</h2>
              {paymentMethods.length === 0 ? (
                <p style={{ color: "var(--color-neutral-500)", fontSize: "var(--text-sm)" }}>Loading payment methods...</p>
              ) : (
                <>
                  <div className="form-group">
                    <label className="form-label form-label-required">Payment Method</label>
                    <select required name="paymentMethodId" className="form-input"
                      value={formData.paymentMethodId} onChange={handleInputChange}>
                      {paymentMethods.map(pm => (
                        <option key={pm.id} value={pm.id}>{pm.name}</option>
                      ))}
                    </select>
                  </div>

                  {selectedPaymentMethod && (
                    <div className={styles.paymentInstructions}>
                      {selectedPaymentMethod.accountName && (
                        <p><strong>Account Name:</strong> {selectedPaymentMethod.accountName}</p>
                      )}
                      {selectedPaymentMethod.accountNumber && (
                        <p><strong>Account Number:</strong> {selectedPaymentMethod.accountNumber}</p>
                      )}
                      {selectedPaymentMethod.instructions && (
                        <p style={{ marginTop: "var(--space-2)" }}>{selectedPaymentMethod.instructions}</p>
                      )}
                    </div>
                  )}

                  {selectedPaymentMethod?.requiresProof && (
                    <div className="form-group" style={{ marginTop: "var(--space-4)" }}>
                      <label className="form-label form-label-required">Upload Payment Screenshot</label>
                      <input required type="file" accept="image/*" onChange={handleFileChange}
                        className="form-input" style={{ padding: "var(--space-2)" }} />
                      <span className="form-hint">JPG, PNG or WebP. Max 5MB.</span>
                    </div>
                  )}
                </>
              )}
            </section>

            {error && (
              <div style={{ padding: "var(--space-3) var(--space-4)", background: "rgb(220 38 38 / 0.08)", border: "1px solid rgb(220 38 38 / 0.3)", borderRadius: "var(--radius-lg)", color: "var(--color-error)", fontWeight: 500 }}>
                ⚠ {error}
              </div>
            )}
          </div>

          {/* Order Summary */}
          <div className={styles.summarySidebar}>
            <div className={styles.summaryCard}>
              <h2 className={styles.sectionTitle}>Order Summary</h2>
              <div className={styles.itemsList}>
                {items.map(item => (
                  <div key={item.id} className={styles.summaryItem}>
                    <div className={styles.summaryItemQty}>{item.quantity}×</div>
                    <div className={styles.summaryItemName}>
                      {item.product.name}
                      <span className={styles.summaryItemVariant}>
                        {[item.variant.color, item.variant.size].filter(Boolean).join(" / ")}
                      </span>
                    </div>
                    <div className={styles.summaryItemPrice}>₱{(item.unitPrice * item.quantity).toLocaleString()}</div>
                  </div>
                ))}
              </div>
              <div className={styles.summaryTotals}>
                <div className={styles.summaryRow}>
                  <span>Subtotal</span><span>₱{subtotal.toLocaleString()}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Shipping</span><span>{shipping > 0 ? `₱${shipping.toLocaleString()}` : "Free"}</span>
                </div>
                <div className={`${styles.summaryRow} ${styles.summaryGrandTotal}`}>
                  <span>Total</span><span>₱{total.toLocaleString()}</span>
                </div>
              </div>
              <button type="submit" disabled={loading || paymentMethods.length === 0}
                className="btn btn-primary btn-full btn-lg" style={{ marginTop: "var(--space-5)" }}>
                {loading ? "Submitting..." : "Place Pre-Order"}
              </button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
