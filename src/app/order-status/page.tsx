"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import styles from "./status.module.css";
import { customerStatusCopy } from "@/lib/order-status-copy";
import { INSTAGRAM_HANDLE_HINT } from "@/lib/instagram";
import { SHOP_INSTAGRAM_HANDLE, SHOP_INSTAGRAM_URL, SITE_NAME } from "@/lib/site";

/**
 * Track an order.
 *
 * Two ways in, because one of them will always be lost:
 *
 *   • the private link from the confirmation screen (`?token=…`), read straight
 *     from the URL and looked up on mount — nothing to type;
 *   • the lookup form (order number + the Instagram username the order was
 *     placed with), for the customer who closed the tab, cleared their history,
 *     or ordered before the private link existed.
 *
 * The refresh token, the mobile number that used to be the second factor, and
 * the per-order API route behind all of it were removed in the intake
 * simplification. This page replaces all three: one endpoint, two doors, one
 * response shape.
 */

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

/**
 * Which of the existing badge colours fits a status.
 *
 * Reuses the classes the storefront already ships rather than introducing a
 * fifth set of greens and ambers: the mapping here is about meaning — waiting,
 * good, finished, dead — not about colour.
 */
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

/**
 * Asks the lookup endpoint about one order.
 *
 * Pure: it returns a result and touches no React state, so the effect below can
 * hand its promise straight to a state-applying callback instead of calling a
 * setState-bearing function synchronously in the effect body — the cascading
 * render the react-hooks rule warns about. Same shape as `requestFields()` in
 * the settings screen.
 */
async function requestOrder(query: string): Promise<LookupOutcome> {
  try {
    const res = await fetch(`/api/orders/lookup?${query}`);
    const json = await res.json();

    if (!res.ok) {
      return {
        ok: false,
        message: json.error?.message || "We could not look that order up.",
      };
    }

    return { ok: true, order: json.data as PublicOrder };
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
  // Starting in the loading state when a token is present, rather than setting
  // it from the effect below: a setState in an effect body is the cascading
  // render the react-hooks rule warns about.
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState("");
  // A working private link means the form is noise, so it starts hidden then.
  const [showForm, setShowForm] = useState(!token);

  /** Puts a lookup result on the screen. */
  const applyOutcome = useCallback((outcome: LookupOutcome) => {
    if (outcome.ok) {
      setError("");
      setOrder(outcome.order);
    } else {
      setOrder(null);
      setError(outcome.message);
      // A failed private link is exactly when the form is needed.
      setShowForm(true);
    }
    setLoading(false);
  }, []);

  /** The form's submit path. Safe to call from an event handler. */
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
    <div className={styles.page}>
      <nav className="navbar">
        <div className="container navbar-inner">
          <Link href="/" className="navbar-brand">
            {SITE_NAME}
          </Link>
        </div>
      </nav>

      <main
        className="container"
        style={{ paddingBlock: "var(--space-12)", maxWidth: "var(--max-w-xl)" }}
      >
        <h1
          className="page-title"
          style={{ textAlign: "center", paddingBlock: 0, marginBottom: "var(--space-2)" }}
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
          <p style={{ textAlign: "center", color: "var(--color-neutral-500)" }}>
            Looking up your order…
          </p>
        )}

        {error && !loading && (
          <p
            className="form-error"
            style={{ justifyContent: "center", marginBottom: "var(--space-6)" }}
          >
            ⚠ {error}
          </p>
        )}

        {showForm && !loading && (
          <form onSubmit={handleSearch} className={styles.searchForm}>
            <div className="form-group">
              <label className="form-label" htmlFor="track-reference">
                Order Number
              </label>
              <input
                id="track-reference"
                type="text"
                required
                className="form-input"
                placeholder="PO-20260917-0001"
                value={reference}
                onChange={(event) => setReference(event.target.value.toUpperCase())}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="track-handle">
                Instagram Username
              </label>
              <input
                id="track-handle"
                type="text"
                required
                className="form-input"
                placeholder="@juandc"
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
              />
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-neutral-500)",
                  marginTop: "var(--space-1)",
                }}
              >
                {INSTAGRAM_HANDLE_HINT}
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary btn-full btn-lg"
              style={{ marginTop: "var(--space-2)" }}
            >
              Track Order
            </button>
          </form>
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
  );
}

/**
 * The result card.
 *
 * Split out of the tracker so the tracker owns fetching and the card owns
 * presentation. Everything the customer is told comes from
 * `customerStatusCopy`, so the wording for a status lives in exactly one place.
 */
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
          borderBottom: "1px solid var(--color-neutral-100)",
        }}
      >
        <p
          style={{
            color: "var(--color-neutral-700)",
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
            color: "var(--color-neutral-500)",
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
            <div style={{ fontWeight: 600 }}>{peso(item.lineTotal)}</div>
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
          borderTop: "1px solid var(--color-neutral-100)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          alignItems: "center",
        }}
      >
        <p
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--color-neutral-600)",
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
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
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
