"use client";

import { useState, useEffect } from "react";
import { useCartStore } from "@/store/cart";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { INSTAGRAM_HANDLE_HINT } from "@/lib/instagram";
import { SHOP_INSTAGRAM_HANDLE, SITE_NAME } from "@/lib/site";
import { BrandLogo } from "@/components/BrandLogo";
import { MAX_ANSWER_LENGTH, type PublicFormField } from "@/lib/order-answers";
import { CustomBagIcon, CustomCardIcon, CustomAlertIcon } from "@/components/CustomerIcons";
import { parseApiResponse } from "@/lib/api-client";
import styles from "./checkout.module.css";
import glass from "../glass.module.css";

export default function CheckoutPage() {
  const router = useRouter();
  const { items, getSubtotal, clearCart, batchId } = useCartStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const [fullName, setFullName] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");

  const [questions, setQuestions] = useState<PublicFormField[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionsFailed, setQuestionsFailed] = useState(false);

  useEffect(() => {
    if (items.length === 0) {
      router.push("/cart");
    }
  }, [items, router]);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/form-fields")
      .then((res) => parseApiResponse<PublicFormField[]>(res))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok || !Array.isArray(data)) {
          setQuestionsFailed(true);
          return;
        }
        setQuestions(data);
      })
      .catch(() => {
        if (!cancelled) setQuestionsFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const missingRequired = questions.filter(
    (question) => question.required && !(answers[question.key] ?? "").trim()
  );

  const paymentStep = questions.length > 0 ? 3 : 2;

  const subtotal = getSubtotal();

  const handleOpenConfirmation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !instagramHandle.trim()) {
      setError("Please fill in all required details.");
      return;
    }
    if (questionsFailed) {
      setError("We could not load every question. Please reload the page and try again.");
      return;
    }
    if (missingRequired.length > 0) {
      const labels = missingRequired.map((question) => `"${question.label}"`).join(", ");
      setError(
        missingRequired.length === 1
          ? `Please answer ${labels}.`
          : `Please answer all of these: ${labels}.`
      );
      return;
    }

    setError(null);
    setShowConfirmModal(true);
  };

  const handleConfirmOrder = async () => {
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
        answers: questions.map((question) => ({
          fieldId: question.key,
          value: (answers[question.key] ?? "").trim(),
        })),
      };

      const orderRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload),
      });

      const { ok, data: orderData, error: orderErr } = await parseApiResponse(
        orderRes,
        "We could not place your order. Please try again."
      );

      if (!ok || !orderData) {
        throw new Error(
          orderErr || "We could not place your order. Please try again."
        );
      }

      clearCart();

      const params = new URLSearchParams({ ref: orderData.reference });
      if (typeof orderData.accessToken === "string" && orderData.accessToken) {
        params.set("token", orderData.accessToken);
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

  /**
   * One operator-defined question, as the customer fills it in.
   *
   * A plain function rather than a nested component: a component declared inside
   * this one is a new type on every render, which remounts the input and drops
   * the caret every time a keystroke lands.
   *
   * `type` maps to the matching native input so the browser's own keyboard and
   * validation help out (`tel`, `email`, `number`); SELECT falls back to a text
   * input if the operator saved no options, because a dropdown with no choices
   * asks nothing and cannot be answered.
   */
  const renderQuestion = (question: PublicFormField) => {
    const value = answers[question.key] ?? "";
    const inputId = `answer-${question.key}`;

    const update = (next: string) =>
      setAnswers((current) => ({ ...current, [question.key]: next }));

    const shared = {
      id: inputId,
      name: inputId,
      className: "form-input",
      value,
      required: question.required,
      placeholder: question.placeholder ?? undefined,
      maxLength: MAX_ANSWER_LENGTH,
    };

    const inputType =
      question.type === "PHONE"
        ? "tel"
        : question.type === "EMAIL"
          ? "email"
          : question.type === "NUMBER"
            ? "number"
            : "text";

    return (
      <div className="form-group" key={question.key}>
        <label
          htmlFor={inputId}
          className={question.required ? "form-label form-label-required" : "form-label"}
        >
          {question.label}
        </label>

        {question.type === "TEXTAREA" ? (
          <textarea {...shared} rows={4} onChange={(e) => update(e.target.value)} />
        ) : question.type === "SELECT" && question.options.length > 0 ? (
          <select {...shared} onChange={(e) => update(e.target.value)}>
            <option value="">{question.placeholder ?? "Choose one"}</option>
            {question.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input {...shared} type={inputType} onChange={(e) => update(e.target.value)} />
        )}

        {question.helpText && <span className="form-hint">{question.helpText}</span>}
      </div>
    );
  };

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
          <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-8) var(--space-4)" }}>
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
              <h2 className={glass.pageTitleEditorial} style={{ fontSize: "1.75rem", margin: 0 }}>Your cart is empty</h2>
              <p style={{ color: "rgba(255,255,255,0.65)", fontSize: "var(--text-sm)", margin: 0 }}>You don&apos;t have any items to check out.</p>
              <Link
                href="/"
                className="btn btn-primary btn-lg"
                style={{ marginTop: "var(--space-5)", display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}
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
              <Link href="/cart" className={glass.navGhostBtn} aria-label="Back to Cart">
                ← <span className={glass.mobileHideText}>Back to </span>Cart
              </Link>
            </div>
          </div>
        </nav>

        <main style={{ flex: 1, maxWidth: "var(--max-w-6xl)", margin: "0 auto", width: "100%", padding: "var(--space-8) var(--space-6)" }}>
          <h1 className={glass.pageTitleEditorial} style={{ fontSize: "clamp(2rem, 4vw, 2.75rem)", textAlign: "left", marginBottom: "var(--space-6)" }}>
            Checkout
          </h1>

          <form onSubmit={handleOpenConfirmation} className={styles.layout}>
            <div className={styles.formSections}>
              <section className={styles.sectionCard}>
                <h2 className={styles.sectionTitle}>1. Contact Details</h2>
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

              {questions.length > 0 && (
                <section className={styles.sectionCard}>
                  <h2 className={styles.sectionTitle}>2. Order Details</h2>
                  <div className={styles.grid}>{questions.map(renderQuestion)}</div>
                </section>
              )}

              <section className={styles.sectionCard}>
                <h2 className={styles.sectionTitle}>{paymentStep}. Payment &amp; shipping</h2>
                <div className={styles.paymentInstructions}>
                  <p style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "white", display: "inline-flex", alignItems: "center", gap: "8px", margin: 0 }}>
                    <CustomCardIcon size={18} /> No payment taken now — order confirmation, payment, and delivery are arranged via Instagram DM.
                  </p>
                </div>

                {error && (
                  <div style={{ padding: "var(--space-3) var(--space-4)", background: "rgba(220,38,38,.15)", border: "1px solid rgba(248,113,113,.3)", borderRadius: "var(--radius-lg)", color: "#f87171", fontWeight: 500, marginTop: "var(--space-4)", display: "flex", alignItems: "center", gap: "8px" }}>
                    <CustomAlertIcon size={16} /> {error}
                  </div>
                )}
              </section>
            </div>

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
                  Review &amp; Place Pre-Order →
                </button>
                <p style={{ fontSize: "var(--text-xs)", color: "rgba(255, 255, 255, 0.78)", marginTop: "var(--space-3)", textAlign: "center" }}>
                  No upfront charge · Confirmed via Instagram DM
                </p>
              </div>
            </div>
          </form>

          {showConfirmModal && (
            <div
              className={styles.modalOverlay}
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-modal-title"
              onClick={(e) => {
                if (e.target === e.currentTarget && !loading) {
                  setShowConfirmModal(false);
                }
              }}
            >
              <div className={styles.modalCard}>
                <div className={styles.modalHeader}>
                  <h3 id="confirm-modal-title" className={styles.modalTitle}>
                    Confirm Your Pre-Order
                  </h3>
                  <p className={styles.modalSubtitle}>
                    Please review your details before final submission
                  </p>
                </div>

                <div className={styles.modalSection}>
                  <div className={styles.modalRow}>
                    <span className={styles.modalRowLabel}>Full Name</span>
                    <span className={styles.modalRowValue}>{fullName}</span>
                  </div>
                  <div className={styles.modalRow}>
                    <span className={styles.modalRowLabel}>Instagram</span>
                    <span className={`${styles.modalRowValue} ${styles.modalHandleHighlight}`}>
                      {instagramHandle.trim().startsWith("@")
                        ? instagramHandle.trim()
                        : `@${instagramHandle.trim()}`}
                    </span>
                  </div>
                </div>

                <div className={styles.modalSection}>
                  <div className={styles.modalRow}>
                    <span className={styles.modalRowLabel}>Pre-Order Items</span>
                    <span className={styles.modalRowValue}>
                      {items.reduce((acc, i) => acc + i.quantity, 0)} pc(s)
                    </span>
                  </div>
                  <div className={styles.modalItemsList}>
                    {items.map((item) => (
                      <div key={item.id} className={styles.modalItemRow}>
                        <span>
                          {item.quantity}× {item.product.name}{" "}
                          <span style={{ color: "rgba(255, 255, 255, 0.78)" }}>
                            ({[item.variant.color, item.variant.size].filter(Boolean).join(" / ")})
                          </span>
                        </span>
                        <span style={{ fontWeight: 600 }}>
                          ₱{(item.unitPrice * item.quantity).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className={styles.modalTotalRow}>
                    <span>Total Amount</span>
                    <span className={styles.modalTotalAmount}>₱{subtotal.toLocaleString()}</span>
                  </div>
                </div>

                <div className={styles.modalNotice}>
                  No payment is charged right now. We will message{" "}
                  <strong style={{ color: "#ff8fa0" }}>
                    {instagramHandle.trim().startsWith("@")
                      ? instagramHandle.trim()
                      : `@${instagramHandle.trim()}`}
                  </strong>{" "}
                  on Instagram to verify sizing, settle payment, and coordinate delivery.
                </div>

                {error && (
                  <div
                    style={{
                      padding: "var(--space-3)",
                      background: "rgba(220, 38, 38, 0.2)",
                      border: "1px solid rgba(248, 113, 113, 0.4)",
                      borderRadius: "var(--radius-md)",
                      color: "#f87171",
                      fontSize: "var(--text-xs)",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <CustomAlertIcon size={14} /> {error}
                  </div>
                )}

                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-full"
                    onClick={() => setShowConfirmModal(false)}
                    disabled={loading}
                  >
                    ← Edit Details
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-full btn-lg"
                    onClick={handleConfirmOrder}
                    disabled={loading}
                    id="final-confirm-order-btn"
                  >
                    {loading ? "Placing Pre-Order..." : "Confirm & Place Pre-Order ✓"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
