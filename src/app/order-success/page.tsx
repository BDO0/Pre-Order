"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, useEffect } from "react";
import { SITE_NAME, SHOP_INSTAGRAM_HANDLE, SHOP_INSTAGRAM_URL } from "@/lib/site";
import { CustomCheckSealIcon } from "@/components/CustomerIcons";
import { BrandLogo } from "@/components/BrandLogo";
import glass from "../glass.module.css";

interface OrderItem {
  productName: string;
  variant: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface OrderDetail {
  reference: string;
  customerName: string | null;
  dropName: string | null;
  total: number;
  items: OrderItem[];
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Click to copy"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 8px",
        borderRadius: "var(--radius-md)",
        background: copied ? "rgba(34,197,94,0.18)" : "rgba(255,255,255,0.10)",
        border: copied ? "1px solid rgba(34,197,94,0.4)" : "1px solid rgba(255,255,255,0.18)",
        color: copied ? "#86efac" : "rgba(255,255,255,0.85)",
        fontSize: "var(--text-xs)",
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 200ms ease",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {copied ? "✓ Copied" : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

function SummaryRow({ label, value, copyValue }: { label: string; value: string; copyValue?: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-2) 0",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <span style={{ fontSize: "var(--text-xs)", color: "rgba(255,255,255,0.55)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
        <span style={{ fontSize: "var(--text-sm)", color: "#fff", fontWeight: 600, textAlign: "right", wordBreak: "break-all" }}>
          {value}
        </span>
        {copyValue !== undefined && <CopyButton text={copyValue} />}
      </div>
    </div>
  );
}

function SuccessContent() {
  const searchParams = useSearchParams();
  const reference    = searchParams.get("ref");
  const token        = searchParams.get("token");

  const trackUrl =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/order-status?token=${encodeURIComponent(token)}`
      : reference
        ? `/order-status?ref=${encodeURIComponent(reference)}`
        : "/order-status";

  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!token && !reference) { setDetailLoading(false); return; }
    const params = new URLSearchParams();
    if (token)     params.set("token", token);
    else if (reference) params.set("ref", reference);

    fetch(`/api/orders/lookup?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (json?.success && json.data) setOrderDetail(json.data as OrderDetail);
      })
      .catch(() => {  })
      .finally(() => setDetailLoading(false));
  }, [token, reference]);

  const buildCopyText = () => {
    if (!orderDetail && !reference) return "";
    const ref   = orderDetail?.reference ?? reference ?? "";
    const name  = orderDetail?.customerName ?? "—";
    const items = (orderDetail?.items ?? [])
      .map((i) => `  • ${i.quantity}× ${i.productName}${i.variant ? ` (${i.variant})` : ""} — ₱${i.lineTotal.toLocaleString("en-US")}`)
      .join("\n");
    const total = orderDetail ? `₱${orderDetail.total.toLocaleString("en-US")}` : "";
    const drop  = orderDetail?.dropName ? `Drop: ${orderDetail.dropName}\n` : "";

    return [
      `📦 Pre-Order Confirmation`,
      `Order Ref: ${ref}`,
      `Name: ${name}`,
      `${drop}`,
      items ? `Items:\n${items}` : "",
      total ? `Total: ${total}` : "",
      "",
      `Please send this message as proof of your pre-order.`,
    ]
      .filter(Boolean)
      .join("\n");
  };

  const [copiedAll, setCopiedAll] = useState(false);
  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(buildCopyText());
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2500);
    } catch {  }
  };

  const [copiedLink, setCopiedLink] = useState(false);
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(trackUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {  }
  };

  const instagramDmUrl = `https://ig.me/m/${SHOP_INSTAGRAM_HANDLE.replace(/^@/, "").replace(/\s+/g, "")}`;

  return (
    <div
      style={{
        position: "relative",
        background: "rgba(255, 255, 255, 0.08)",
        backdropFilter: "blur(32px) saturate(200%)",
        WebkitBackdropFilter: "blur(32px) saturate(200%)",
        borderRadius: "var(--radius-2xl)",
        border: "1px solid rgba(255, 255, 255, 0.16)",
        padding: "clamp(var(--space-6), 5vw, var(--space-10)) clamp(var(--space-4), 4vw, var(--space-8))",
        maxWidth: "600px",
        width: "100%",
        boxShadow:
          "0 24px 64px rgba(0, 0, 0, 0.65), 0 0 36px rgba(255, 175, 200, 0.22), 0 0 64px rgba(156, 232, 248, 0.14), inset 0 1.5px 1px 0 rgba(255, 255, 255, 0.55), inset 0 -1px 1px 0 rgba(255, 255, 255, 0.1)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-4)",
        textAlign: "center",
      }}
    >
      {}
      <div style={{ display: "flex", justifyContent: "flex-start", width: "100%" }}>
        <Link href="/" className={glass.navBack} style={{ fontSize: "var(--text-sm)" }}>
          ← Back to Shop
        </Link>
      </div>

      {}
      <div
        style={{
          width: "76px",
          height: "76px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(168, 16, 56, 0.45) 0%, rgba(255, 255, 255, 0.05) 70%)",
          border: "1px solid rgba(255, 200, 220, 0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 0 28px rgba(255, 175, 200, 0.35)",
        }}
        aria-hidden="true"
      >
        <CustomCheckSealIcon size={46} style={{ color: "#ffffff" }} />
      </div>

      {}
      <h1
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "clamp(2rem, 4vw, 2.5rem)",
          fontWeight: 700,
          background: "linear-gradient(135deg, #ffffff 0%, #ffeaf0 50%, #f7b4c4 100%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          WebkitTextFillColor: "transparent",
          margin: 0,
          letterSpacing: "-0.01em",
        }}
      >
        Order Received!
      </h1>

      <p style={{ fontSize: "var(--text-base)", color: "rgba(255, 255, 255, 0.75)", maxWidth: "440px", lineHeight: 1.6, margin: 0 }}>
        Thank you for your pre-order. We&apos;ll message you on Instagram to confirm
        sizing, shipping and payment.
      </p>

      {

}
      {(reference || orderDetail) && (
        <div
          id="order-summary-card"
          style={{
            width: "100%",
            borderRadius: "var(--radius-xl)",
            border: "1px solid rgba(255,200,220,0.35)",
            background: "rgba(168,16,56,0.13)",
            backdropFilter: "blur(12px)",
            overflow: "hidden",
          }}
        >
          {}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              padding: "var(--space-3) var(--space-4)",
              background: "rgba(234, 179, 8, 0.18)",
              borderBottom: "1px solid rgba(234,179,8,0.3)",
            }}
          >
            <span style={{ fontSize: "1rem" }}>📸</span>
            <p style={{ margin: 0, fontSize: "var(--text-xs)", fontWeight: 700, color: "#fde68a", textAlign: "left", lineHeight: 1.4 }}>
              Screenshot this as your proof of order before leaving this page.
            </p>
          </div>

          {}
          <div style={{ padding: "var(--space-4) var(--space-5)" }}>

            {}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
              <p style={{ margin: 0, fontSize: "var(--text-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.6)" }}>
                Order Summary
              </p>
              <button
                type="button"
                id="copy-order-summary-btn"
                onClick={handleCopyAll}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "var(--space-2) var(--space-3)",
                  borderRadius: "var(--radius-lg)",
                  background: copiedAll ? "rgba(34,197,94,0.22)" : "rgba(255,255,255,0.12)",
                  border: copiedAll ? "1px solid rgba(34,197,94,0.5)" : "1px solid rgba(255,255,255,0.22)",
                  color: copiedAll ? "#86efac" : "rgba(255,255,255,0.95)",
                  fontSize: "var(--text-xs)",
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "all 200ms ease",
                }}
              >
                {copiedAll ? (
                  <>✓ Copied!</>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy All Info
                  </>
                )}
              </button>
            </div>

            {}
            {detailLoading && (
              <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "var(--text-sm)", textAlign: "center", padding: "var(--space-4) 0" }}>
                Loading order details…
              </p>
            )}

            {}
            {!detailLoading && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {}
                <SummaryRow
                  label="Order Ref"
                  value={orderDetail?.reference ?? reference ?? "—"}
                  copyValue={orderDetail?.reference ?? reference ?? ""}
                />

                {}
                {orderDetail?.customerName && (
                  <SummaryRow
                    label="Name"
                    value={orderDetail.customerName}
                    copyValue={orderDetail.customerName}
                  />
                )}

                {}
                {orderDetail?.dropName && (
                  <SummaryRow
                    label="Drop"
                    value={orderDetail.dropName}
                  />
                )}

                {}
                {orderDetail && orderDetail.items.length > 0 && (
                  <div style={{ padding: "var(--space-2) 0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                    <p style={{ margin: "0 0 var(--space-2) 0", fontSize: "var(--text-xs)", color: "rgba(255,255,255,0.55)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Items
                    </p>
                    {orderDetail.items.map((item, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: "var(--space-2)",
                          marginBottom: i < orderDetail.items.length - 1 ? "var(--space-1)" : 0,
                        }}
                      >
                        <span style={{ fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.85)", textAlign: "left", lineHeight: 1.4 }}>
                          {item.quantity}× {item.productName}
                          {item.variant && (
                            <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "var(--text-xs)", marginLeft: "4px" }}>
                              ({item.variant})
                            </span>
                          )}
                        </span>
                        <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "#fff", whiteSpace: "nowrap" }}>
                          ₱{item.lineTotal.toLocaleString("en-US")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {}
                {orderDetail && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) 0 var(--space-1) 0" }}>
                    <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>Total</span>
                    <span style={{ fontSize: "var(--text-xl)", fontWeight: 800, color: "#ffffff", letterSpacing: "-0.01em" }}>
                      ₱{orderDetail.total.toLocaleString("en-US")}
                    </span>
                  </div>
                )}
              </div>
            )}

            {}
            <div
              style={{
                marginTop: "var(--space-4)",
                paddingTop: "var(--space-4)",
                borderTop: "1px solid rgba(255,255,255,0.10)",
                textAlign: "center",
              }}
            >
              <p style={{ margin: "0 0 var(--space-3) 0", fontSize: "var(--text-xs)", color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
                Copy your order info above, then tap below to open our Instagram DM and paste it as your message.
              </p>
              <a
                href={instagramDmUrl}
                target="_blank"
                rel="noopener noreferrer"
                id="dm-instagram-btn"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "var(--space-2)",
                  width: "100%",
                  padding: "var(--space-3) var(--space-4)",
                  borderRadius: "var(--radius-xl)",
                  background: "linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "var(--text-sm)",
                  textDecoration: "none",
                  boxShadow: "0 4px 20px rgba(131,58,180,0.35)",
                  transition: "opacity 200ms ease",
                }}
                onMouseOver={(e) => (e.currentTarget.style.opacity = "0.88")}
                onMouseOut={(e) => (e.currentTarget.style.opacity = "1")}
              >
                {}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                </svg>
                DM us on Instagram @{SHOP_INSTAGRAM_HANDLE.replace(/^@/, "")}
              </a>
            </div>
          </div>
        </div>
      )}

      {}
      <p style={{ fontSize: "var(--text-sm)", color: "rgba(255, 255, 255, 0.85)", maxWidth: "440px", margin: 0, lineHeight: 1.6 }}>
        Save the link below to track your order status anytime. Keep it private.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", justifyContent: "center", width: "100%" }}>
        <code
          style={{
            fontSize: "var(--text-xs)",
            background: "rgba(255, 255, 255, 0.07)",
            color: "rgba(255, 255, 255, 0.95)",
            padding: "var(--space-2) var(--space-4)",
            borderRadius: "var(--radius-full)",
            maxWidth: "100%",
            overflowWrap: "anywhere",
            border: "1px solid rgba(255, 255, 255, 0.15)",
          }}
        >
          {trackUrl}
        </code>
        <button type="button" onClick={handleCopyLink} className="btn btn-secondary btn-sm">
          {copiedLink ? "Copied ✓" : "Copy Link"}
        </button>
      </div>

      {}
      <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-2)", flexWrap: "wrap", justifyContent: "center" }}>
        <Link href="/" className="btn btn-secondary btn-lg" style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
          ← Back to Shop
        </Link>
        <Link href={trackUrl} className="btn btn-primary btn-lg" style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
          Track Your Order →
        </Link>
      </div>
      <p style={{ fontSize: "var(--text-xs)", color: "rgba(255, 255, 255, 0.78)", marginTop: "var(--space-1)" }}>
        Lost the link? Look your order up anytime with your order number and Instagram username.
      </p>
    </div>
  );
}

export default function OrderSuccessPage() {
  return (
    <div className={glass.glassPage}>
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
          <Suspense
            fallback={
              <div style={{ color: "rgba(255,255,255,.6)", fontFamily: "var(--font-display)" }}>
                Loading confirmation…
              </div>
            }
          >
            <SuccessContent />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
