"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import styles from "./status.module.css";
import { format } from "date-fns";

function OrderTracker() {
  const searchParams = useSearchParams();
  const initialRef = searchParams.get("ref") || "";

  const [reference, setReference] = useState(initialRef);
  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<any>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setOrder(null);

    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(reference)}?mobile=${encodeURIComponent(mobile)}`);
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to find order.");
      }

      setOrder(json.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusText = (status: string) => status.replace(/_/g, " ");

  return (
    <div className={styles.page}>
      <nav className="navbar">
        <div className="container navbar-inner">
          <Link href="/" className="navbar-brand">ANA Clothing</Link>
        </div>
      </nav>

      <main className="container" style={{ paddingBlock: "var(--space-12)", maxWidth: "var(--max-w-xl)" }}>
        <h1 className="page-title" style={{ textAlign: "center", paddingBlock: 0, marginBottom: "var(--space-2)" }}>
          Track Your Order
        </h1>
        <p className="page-subtitle" style={{ textAlign: "center", marginBottom: "var(--space-8)" }}>
          Enter your order reference number and mobile number to view your pre-order status.
        </p>

        <form onSubmit={handleSearch} className={styles.searchForm}>
          <div className="form-group">
            <label className="form-label">Order Reference Number</label>
            <input
              type="text"
              required
              className="form-input"
              placeholder="PO-YYYYMMDD-XXXX"
              value={reference}
              onChange={(e) => setReference(e.target.value.toUpperCase())}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Mobile Number</label>
            <input
              type="text"
              required
              className="form-input"
              placeholder="09XXXXXXXXX"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
            />
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary btn-full btn-lg" style={{ marginTop: "var(--space-2)" }}>
            {loading ? "Searching..." : "Track Order"}
          </button>
          {error && <p className="form-error" style={{ justifyContent: "center", marginTop: "var(--space-2)" }}>⚠ {error}</p>}
        </form>

        {order && (
          <div className={styles.resultCard}>
            <div className={styles.resultHeader}>
              <div>
                <p className={styles.resultLabel}>Order Reference</p>
                <p className={styles.resultRef}>{order.reference}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p className={styles.resultLabel}>Status</p>
                <div className={`badge badge-${order.status === 'COMPLETED' ? 'completed' : order.status === 'CANCELLED' ? 'cancelled' : 'pending'}`}>
                  {getStatusText(order.status)}
                </div>
              </div>
            </div>

            <div className={styles.itemsList}>
              <h3 className={styles.sectionTitle}>Order Items</h3>
              {order.items.map((item: any, idx: number) => (
                <div key={idx} className={styles.itemRow}>
                  <div className={styles.itemQty}>{item.quantity}x</div>
                  <div>
                    <p className={styles.itemName}>{item.productName}</p>
                    <p className={styles.itemVariant}>
                      {[item.variant.color, item.variant.size].filter(Boolean).join(" / ")}
                    </p>
                  </div>
                </div>
              ))}
              <div className={styles.totalRow}>
                <span>Total Amount</span>
                <span>₱{Number(order.total).toLocaleString()}</span>
              </div>
            </div>

            <div className={styles.timeline}>
              <h3 className={styles.sectionTitle}>Order History</h3>
              {order.statusHistory.map((history: any, idx: number) => (
                <div key={idx} className={styles.timelineItem}>
                  <div className={styles.timelineDot} />
                  <div className={styles.timelineContent}>
                    <p className={styles.timelineStatus}>{getStatusText(history.toStatus)}</p>
                    <p className={styles.timelineDate}>{format(new Date(history.createdAt), "MMM d, yyyy h:mm a")}</p>
                    {history.note && <p className={styles.timelineNote}>{history.note}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function OrderStatusPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>Loading...</div>}>
      <OrderTracker />
    </Suspense>
  );
}
