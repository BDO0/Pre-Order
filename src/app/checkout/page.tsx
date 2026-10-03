"use client";
import { useState, useEffect } from "react";
import { useCartStore } from "@/store/cart";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { INSTAGRAM_HANDLE_HINT, normaliseInstagramHandle } from "@/lib/instagram";
import { SHOP_INSTAGRAM_HANDLE, SHOP_INSTAGRAM_URL, SITE_NAME } from "@/lib/site";
import { BrandLogo } from "@/components/BrandLogo";
import { MAX_ANSWER_LENGTH, type PublicFormField } from "@/lib/order-answers";
import { CustomBagIcon, CustomCardIcon, CustomAlertIcon } from "@/components/CustomerIcons";
import { parseApiResponse } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
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
  const [successData, setSuccessData] = useState<{
    reference: string;
    accessToken: string | null;
    total: number;
    copiedAll: boolean;
  } | null>(null);
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
          instagramHandle: normaliseInstagramHandle(instagramHandle) ?? instagramHandle.trim(),
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
      setShowConfirmModal(false);
      setSuccessData({
        reference: orderData.reference,
        accessToken: typeof orderData.accessToken === "string" ? orderData.accessToken : null,
        total: Number(orderData.total ?? getSubtotal()),
        copiedAll: false,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };
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
          {questionsFailed && (
            <div style={{ marginBottom: "var(--space-6)", padding: "var(--space-4)", background: "rgba(220,38,38,.15)", border: "1px solid rgba(248,113,113,.3)", borderRadius: "var(--radius-lg)", color: "#f87171", fontWeight: 500, display: "flex", alignItems: "center", gap: "8px" }}>
              <CustomAlertIcon size={20} /> We could not load the order details questions. Please reload the page to try again.
            </div>
          )}
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
                        {formatMoney((item.unitPrice * item.quantity))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className={styles.summaryTotals}>
                  <div className={`${styles.summaryRow} ${styles.summaryGrandTotal}`}>
                    <span>Total</span><span>{formatMoney(subtotal)}</span>
                  </div>
                </div>
                <button type="submit" disabled={loading || questionsFailed}
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
                          {formatMoney((item.unitPrice * item.quantity))}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className={styles.modalTotalRow}>
                    <span>Total Amount</span>
                    <span className={styles.modalTotalAmount}>{formatMoney(subtotal)}</span>
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

          {

}
          {successData && (
            <div
              className={styles.modalOverlay}
              role="dialog"
              aria-modal="true"
              aria-labelledby="success-modal-title"
            >
              <div className={styles.modalCard} style={{ maxWidth: "540px" }}>

                {}
                <div style={{
                  display: "flex", alignItems: "center", gap: "12px",
                  padding: "var(--space-4) var(--space-5)",
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  borderRadius: "var(--radius-xl)",
                  marginBottom: "var(--space-3)",
                }}>
                  <span style={{ fontSize: "2rem" }}>📸</span>
                  <p style={{ margin: 0, fontSize: "var(--text-base)", fontWeight: 700, color: "#fff", lineHeight: 1.3 }}>
                    Save your order details
                    <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 400, color: "rgba(255,255,255,0.8)", marginTop: "4px" }}>
                      Please take a screenshot or copy the info below before closing this page.
                    </span>
                  </p>
                </div>

                {}
                <div className={styles.modalHeader} style={{ textAlign: "center", paddingBottom: "var(--space-3)", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                  <h2 id="success-modal-title" className={styles.modalTitle}>
                    Order Placed Successfully!
                  </h2>
                  <p className={styles.modalSubtitle}>
                    Your pre-order has been received. We&apos;ll DM you on Instagram to confirm.
                  </p>
                </div>

                {}
                <div style={{
                  textAlign: "center",
                  padding: "var(--space-4)",
                  background: "rgba(168,16,56,0.2)",
                  borderRadius: "var(--radius-xl)",
                  border: "1px dashed rgba(255,200,220,0.4)",
                }}>
                  <p style={{ margin: 0, fontSize: "var(--text-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.6)", marginBottom: "4px" }}>
                    Your Order Reference
                  </p>
                  <p style={{ margin: 0, fontSize: "2rem", fontWeight: 800, fontFamily: "var(--font-display)", color: "#fff", letterSpacing: "0.06em", textShadow: "0 2px 12px rgba(220,40,85,0.5)" }}>
                    {successData.reference}
                  </p>
                </div>

                {}
                <div className={styles.modalSection}>
                  <div className={styles.modalRow}>
                    <span className={styles.modalRowLabel}>Name</span>
                    <span className={styles.modalRowValue}>{fullName}</span>
                  </div>
                  <div className={styles.modalRow}>
                    <span className={styles.modalRowLabel}>Instagram</span>
                    <span className={`${styles.modalRowValue} ${styles.modalHandleHighlight}`}>
                      {instagramHandle.trim().startsWith("@") ? instagramHandle.trim() : `@${instagramHandle.trim()}`}
                    </span>
                  </div>
                </div>

                {}
                <div className={styles.modalSection}>
                  <div className={styles.modalRow}>
                    <span className={styles.modalRowLabel}>Pre-Order Items</span>
                    <span className={styles.modalRowValue}>{items.reduce((a, i) => a + i.quantity, 0)} pc(s)</span>
                  </div>
                  <div className={styles.modalItemsList}>
                    {items.map((item) => (
                      <div key={item.id} className={styles.modalItemRow}>
                        <span>
                          {item.quantity}× {item.product.name}{" "}
                          <span style={{ color: "rgba(255,255,255,0.65)" }}>
                            ({[item.variant.color, item.variant.size].filter(Boolean).join(" / ")})
                          </span>
                        </span>
                        <span style={{ fontWeight: 600 }}>{formatMoney((item.unitPrice * item.quantity))}</span>
                      </div>
                    ))}
                  </div>
                  <div className={styles.modalTotalRow}>
                    <span>Total</span>
                    <span className={styles.modalTotalAmount}>{formatMoney(successData.total)}</span>
                  </div>
                </div>

                {}
                <button
                  type="button"
                  id="copy-all-order-info-btn"
                  onClick={async () => {
                    const handle = instagramHandle.trim().startsWith("@") ? instagramHandle.trim() : `@${instagramHandle.trim()}`;
                    const itemLines = items
                      .map((i) => `  • ${i.quantity}× ${i.product.name}${[i.variant.color, i.variant.size].filter(Boolean).length > 0 ? ` (${[i.variant.color, i.variant.size].filter(Boolean).join(" / ")})` : ""} — ${formatMoney(i.unitPrice * i.quantity)}`)
                      .join("\n");
                    const text = [
                      "📦 Pre-Order Confirmation",
                      `Order Ref: ${successData.reference}`,
                      `Name: ${fullName}`,
                      `Instagram: ${handle}`,
                      "",
                      `Items:\n${itemLines}`,
                      "",
                      `Total: ${formatMoney(successData.total)}`,
                      "",
                      "Please send this as proof of your pre-order.",
                    ].join("\n");
                    try {
                      await navigator.clipboard.writeText(text);
                      setSuccessData((prev) => prev ? { ...prev, copiedAll: true } : prev);
                      setTimeout(() => setSuccessData((prev) => prev ? { ...prev, copiedAll: false } : prev), 2500);
                    } catch {  }
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    padding: "var(--space-3)",
                    borderRadius: "var(--radius-xl)",
                    background: successData.copiedAll ? "rgba(34,197,94,0.18)" : "rgba(255,255,255,0.10)",
                    border: successData.copiedAll ? "1px solid rgba(34,197,94,0.45)" : "1px solid rgba(255,255,255,0.2)",
                    color: successData.copiedAll ? "#86efac" : "rgba(255,255,255,0.95)",
                    fontWeight: 700,
                    fontSize: "var(--text-sm)",
                    cursor: "pointer",
                    transition: "all 220ms ease",
                  }}
                >
                  {successData.copiedAll ? (
                    "✓ Copied to clipboard!"
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      Copy All Order Info
                    </>
                  )}
                </button>

                {}
                <div style={{ textAlign: "center" }}>
                  <p style={{ margin: "0 0 var(--space-2) 0", fontSize: "var(--text-xs)", color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
                    Copy your order info above, then tap below to DM us on Instagram and paste it.
                  </p>
                  <a
                    href={`https://ig.me/m/${SHOP_INSTAGRAM_HANDLE.replace(/^@/, "").replace(/\s+/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    id="success-dm-instagram-btn"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      width: "100%",
                      padding: "var(--space-3) var(--space-4)",
                      borderRadius: "var(--radius-xl)",
                      background: "linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%)",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: "var(--text-sm)",
                      textDecoration: "none",
                      boxShadow: "0 4px 20px rgba(131,58,180,0.35)",
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                    </svg>
                    DM us on Instagram @{SHOP_INSTAGRAM_HANDLE.replace(/^@/, "")}
                  </a>
                </div>

                {}
                <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-1)" }}>
                  <Link
                    href="/"
                    className="btn btn-secondary btn-full"
                    onClick={clearCart}
                  >
                    ← Back to Shop
                  </Link>
                  <Link
                    href={
                      successData.accessToken
                        ? `/order-status?token=${encodeURIComponent(successData.accessToken)}`
                        : `/order-status?ref=${encodeURIComponent(successData.reference)}`
                    }
                    className="btn btn-primary btn-full"
                    onClick={clearCart}
                  >
                    Track Order →
                  </Link>
                </div>

              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

