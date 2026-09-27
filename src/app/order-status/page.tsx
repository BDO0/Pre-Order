"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import styles from "./status.module.css";
import glass from "../glass.module.css";
import { customerStatusCopy } from "@/lib/order-status-copy";
import { SHOP_INSTAGRAM_HANDLE, SHOP_INSTAGRAM_URL, SITE_NAME } from "@/lib/site";
import { BrandLogo } from "@/components/BrandLogo";
import { CustomAlertIcon } from "@/components/CustomerIcons";
import { parseApiResponse } from "@/lib/api-client";
interface PublicOrderItem {
  productName: string;
  variant: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}
interface PublicOrder {
  reference: string;
  status: string;
  paymentStatus: "UNPAID" | "PAID";
  placedAt: string;
  dropName: string | null;
  customerName: string | null;
  items: PublicOrderItem[];
  subtotal: number;
  total: number;
  timeline: { status: string; at: string }[];
}
function badgeClass(status: string): string {
  switch (status) {
    case "PENDING":
    case "AWAITING_PAYMENT":
      return "badge badge-pending";
    case "PAYMENT_REVIEW":
      return "badge badge-coming";
    case "CONFIRMED":
    case "PROCESSING":
      return "badge badge-confirmed";
    case "READY":
    case "SHIPPED":
      return "badge badge-open";
    case "COMPLETED":
      return "badge badge-completed";
    case "CANCELLED":
    case "REJECTED":
      return "badge badge-cancelled";
    default:
      return "badge badge-closed";
  }
}
function peso(amount: number): string {
  return `₱${amount.toLocaleString()}`;
}
type LookupOutcome =
  | { ok: true; order: PublicOrder }
  | { ok: false; message: string };
async function requestOrder(query: string): Promise<LookupOutcome> {
  try {
    const res = await fetch(`/api/orders/lookup?${query}`);
    const { ok, data, error } = await parseApiResponse(res, "We could not look that order up.");
    if (!ok || !data) {
      return {
        ok: false,
        message: error || "We could not look that order up.",
      };
    }
    return { ok: true, order: data as PublicOrder };
  } catch {
    return {
      ok: false,
      message: "We could not reach the shop just now. Check your connection and try again.",
    };
  }
}
function OrderTracker() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const refFromUrl = searchParams.get("ref") ?? "";
  const [reference, setReference] = useState(refFromUrl);
  const [handle, setHandle] = useState("");
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(!token);
  const applyOutcome = useCallback((outcome: LookupOutcome) => {
    if (outcome.ok) {
      setError("");
      setOrder(outcome.order);
    } else {
      setOrder(null);
      setError(outcome.message);
      setShowForm(true);
    }
    setLoading(false);
  }, []);
  const lookUp = (query: string) => {
    void requestOrder(query).then(applyOutcome);
  };
  useEffect(() => {
    if (!token) return;
    void requestOrder(`token=${encodeURIComponent(token)}`).then(applyOutcome);
  }, [token, applyOutcome]);
  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (!reference.trim() || !handle.trim()) {
      setError("Please fill in both your order number and your Instagram username.");
      return;
    }
    setLoading(true);
    setError("");
    void lookUp(
      `ref=${encodeURIComponent(reference.trim())}&handle=${encodeURIComponent(handle.trim())}`
    );
  };
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
        <main className={styles.mainContainer}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "var(--space-3)" }}>
            <BrandLogo variant="monogram" height={44} color="#fca5a5" />
          </div>
          <h1
            className={glass.pageTitleEditorial}
            style={{
              fontSize: "clamp(2rem, 4vw, 2.75rem)",
              textAlign: "center",
              paddingBlock: 0,
              marginBottom: "var(--space-2)",
            }}
          >
            Track Your Order
          </h1>
          <p
            className="page-subtitle"
            style={{ textAlign: "center", marginBottom: "var(--space-8)" }}
          >
            {showForm
              ? "Enter your order number and the Instagram username you ordered with."
              : "Here is where your pre-order is right now."}
          </p>
          {loading && (
            <p style={{ textAlign: "center", color: "rgba(255, 255, 255, 0.85)" }}>
              Looking up your order…
            </p>
          )}
          {error && !loading && (
            <p
              className="form-error"
              style={{ justifyContent: "center", marginBottom: "var(--space-6)", color: "#f87171", display: "flex", alignItems: "center", gap: "6px" }}
            >
              <CustomAlertIcon size={16} /> {error}
            </p>
          )}
          {showForm && !loading && (
            <div
              style={{
                padding: "var(--space-6)",
                background: "rgba(255,255,255,.055)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,.1)",
                borderRadius: "var(--radius-2xl)",
                textAlign: "center",
                boxShadow: "0 16px 48px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.07)",
              }}
            >
              <p
                style={{
                  fontSize: "var(--text-base)",
                  color: "rgba(255,255,255,.7)",
                  marginBottom: "var(--space-4)",
                  lineHeight: 1.6,
                }}
              >
                Lost your order link? Send us a DM on Instagram <strong style={{ color: "#ff8fa0" }}>@{SHOP_INSTAGRAM_HANDLE}</strong> and we&apos;ll send it right to you!
              </p>
              <a
                href={SHOP_INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary btn-lg"
              >
                Message @{SHOP_INSTAGRAM_HANDLE}
              </a>
            </div>
          )}
          {order && (
            <ResultCard
              order={order}
              showStartOver={!token}
              onStartOver={() => {
                setOrder(null);
                setError("");
                setHandle("");
                setShowForm(true);
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
function ResultCard({
  order,
  showStartOver,
  onStartOver,
}: {
  order: PublicOrder;
  showStartOver: boolean;
  onStartOver: () => void;
}) {
  const copy = customerStatusCopy(order.status);
  return (
    <div className={styles.resultCard}>
      <div className={styles.resultHeader}>
        <div>
          <p className={styles.resultLabel}>Order Number</p>
          <p className={styles.resultRef}>{order.reference}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p className={styles.resultLabel}>Status</p>
          <div className={badgeClass(order.status)}>{copy.label}</div>
        </div>
      </div>
      <div
        style={{
          padding: "var(--space-6)",
          borderBottom: "1px solid rgba(255,255,255,.07)",
        }}
      >
        <p
          style={{
            color: "rgba(255,255,255,.75)",
            fontSize: "var(--text-base)",
            lineHeight: 1.6,
          }}
        >
          {copy.detail}
        </p>
        <div
          style={{
            marginTop: "var(--space-4)",
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-4)",
            fontSize: "var(--text-sm)",
            color: "rgba(255, 255, 255, 0.78)",
          }}
        >
          {order.customerName && <span>Placed by {order.customerName}</span>}
          <span>
            Placed {format(new Date(order.placedAt), "MMM d, yyyy h:mm a")}
          </span>
          {order.dropName && <span>Drop: {order.dropName}</span>}
          <span>
            Payment: {order.paymentStatus === "PAID" ? "recorded as paid" : "not yet recorded"}
          </span>
        </div>
      </div>
      <div className={styles.itemsList}>
        <h3 className={styles.sectionTitle}>Your Items</h3>
        {order.items.map((item, index) => (
          <div key={`${item.productName}-${item.variant}-${index}`} className={styles.itemRow}>
            <div className={styles.itemQty}>{item.quantity}×</div>
            <div style={{ flex: 1 }}>
              <p className={styles.itemName}>{item.productName}</p>
              {item.variant && <p className={styles.itemVariant}>{item.variant}</p>}
            </div>
            <div style={{ fontWeight: 600, color: "white" }}>{peso(item.lineTotal)}</div>
          </div>
        ))}
        <div className={styles.totalRow}>
          <span>Total</span>
          <span>{peso(order.total)}</span>
        </div>
      </div>
      <div className={styles.timeline}>
        <h3 className={styles.sectionTitle}>Progress</h3>
        {order.timeline.map((entry, index) => (
          <div key={`${entry.status}-${entry.at}-${index}`} className={styles.timelineItem}>
            <div className={styles.timelineDot} />
            <div className={styles.timelineContent}>
              <p className={styles.timelineStatus}>
                {customerStatusCopy(entry.status).label}
              </p>
              <p className={styles.timelineDate}>
                {format(new Date(entry.at), "MMM d, yyyy h:mm a")}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          padding: "var(--space-6)",
          borderTop: "1px solid rgba(255,255,255,.07)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          alignItems: "center",
        }}
      >
        <p
          style={{
            fontSize: "var(--text-sm)",
            color: "rgba(255, 255, 255, 0.82)",
            textAlign: "center",
          }}
        >
          {copy.awaitingCustomer
            ? `Message us at @${SHOP_INSTAGRAM_HANDLE} to move this along.`
            : "Any questions about this order? Message us on Instagram."}
        </p>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", justifyContent: "center" }}>
          <a
            href={SHOP_INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary btn-sm"
          >
            Message @{SHOP_INSTAGRAM_HANDLE}
          </a>
          <Link href="/" className="btn btn-secondary btn-sm">
            Return Home
          </Link>
          {showStartOver && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onStartOver}>
              Look up another order
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
export default function OrderStatusPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100dvh",
            background: "#0d0205",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255, 255, 255, 0.85)",
            fontFamily: "var(--font-display)",
          }}
        >
          Loading…
        </div>
      }
    >
      <OrderTracker />
    </Suspense>
  );
}
