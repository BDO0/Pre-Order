"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { getValidNextStatuses } from "@/lib/order-state-machine";
import { PAYMENT_ACTIONS, type PaymentAction } from "@/lib/payment-state-machine";
import { REDACTED_FIELD, isRedacted } from "@/lib/redaction";
import type { OrderStatus } from "@prisma/client";

interface OrderCapabilities {
  updateOrder: boolean;
  verifyPayment: boolean;
  readCustomer: boolean;
}

/** Shape of the audit rows the order endpoint returns. */
interface AuditLogEntry {
  id: string;
  action: string;
  actor: string;
  createdAt: string;
  metadata?: { note?: string | null } | null;
}

/**
 * A stored proof key is not a URL — proofs live outside `public/` and are only
 * reachable through the guarded admin route. Keys may contain a slash, so each
 * segment is encoded separately.
 */
function proofUrl(fileKey: string): string {
  const segments = fileKey
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent);
  return `/api/admin/proofs/${segments.join("/")}`;
}

export default function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);

  const flash = (message: string) => {
    setNotice(message);
    setActionError("");
    setTimeout(() => setNotice(""), 4000);
  };

  const fetchOrder = async () => {
    try {
      const res = await fetch(`/api/admin/orders/${id}`);
      if (!res.ok) throw new Error("Failed to load order");
      const json = await res.json();
      setOrder(json.data);
      // Re-seed the notes box from the stored value on every load, so it can
      // never show a draft that has already been superseded. Deliberately inside
      // this async callback rather than an effect body: setting state directly
      // in an effect causes a cascading render.
      setNotesDraft(json.data?.notes ?? "");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrder();
  }, [id]);

  const handleUpdateStatus = async (newStatus: string) => {
    setUpdating(true);
    setActionError("");
    try {
      const res = await fetch(`/api/admin/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, note: statusNote || undefined }),
      });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error?.message || "Failed to update status");

      setStatusNote("");
      await fetchOrder(); // Reload
      flash(`Order marked as ${newStatus.replace(/_/g, " ")}.`);
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setUpdating(false);
    }
  };

  /**
   * Payment verification is its own request. It changes paymentStatus only —
   * verifying money never silently moves the order through fulfilment.
   */
  const handlePaymentAction = async (action: PaymentAction) => {
    setUpdating(true);
    setActionError("");
    try {
      const res = await fetch(`/api/admin/orders/${id}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: paymentNote || undefined }),
      });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error?.message || "Failed to update payment");

      setPaymentNote("");
      await fetchOrder();
      flash(`${PAYMENT_ACTIONS[action].label} recorded.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update payment");
    } finally {
      setUpdating(false);
    }
  };

  const handleSaveNotes = async () => {
    setNotesSaving(true);
    setActionError("");
    try {
      const res = await fetch(`/api/admin/orders/${id}/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesDraft }),
      });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error?.message || "Failed to save note");

      await fetchOrder();
      flash("Internal note saved.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setNotesSaving(false);
    }
  };

  if (loading) return <div>Loading order...</div>;
  if (error) return <div style={{ color: "red" }}>{error}</div>;
  if (!order) return <div>Order not found.</div>;

  const customerInfo = order.customerSnapshot as any;
  const deliveryInfo = order.deliverySnapshot as any;

  // The API ships the decisions; the UI only renders them. `allowedTransitions`
  // and `allowedPaymentActions` arrive already filtered by this admin's
  // permissions, so a VIEWER is never shown a button the API would answer with a
  // 403. The local fallback just keeps the page usable against an older payload.
  const capabilities: OrderCapabilities = order.capabilities ?? {
    updateOrder: false,
    verifyPayment: false,
    readCustomer: false,
  };
  const transitions: OrderStatus[] =
    order.allowedTransitions ?? getValidNextStatuses(order.status as OrderStatus);
  const paymentActions: PaymentAction[] = order.allowedPaymentActions ?? [];
  const customerRestricted =
    !capabilities.readCustomer || isRedacted(customerInfo?.mobileNumber);

  return (
    <div>
      {notice && (
        <div style={{ padding: "var(--space-3) var(--space-4)", background: "rgb(22 163 74 / 0.08)", border: "1px solid rgb(22 163 74 / 0.3)", borderRadius: "var(--radius-lg)", color: "var(--color-success)", fontWeight: 500, marginBottom: "var(--space-4)" }}>
          ✓ {notice}
        </div>
      )}
      {actionError && (
        <div role="alert" style={{ padding: "var(--space-3) var(--space-4)", background: "rgb(220 38 38 / 0.08)", border: "1px solid rgb(220 38 38 / 0.3)", borderRadius: "var(--radius-lg)", color: "var(--color-error)", fontWeight: 500, marginBottom: "var(--space-4)" }}>
          ⚠ {actionError}
        </div>
      )}
      <div style={{ marginBottom: "var(--space-6)" }}>
        <Link href="/admin/orders" style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", textDecoration: "none" }}>
          ← Back to Orders
        </Link>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "var(--space-2)" }}>
          <div>
            <h1 className="admin-page-title" style={{ marginBottom: 0 }}>
              Order {order.reference}
            </h1>
            <p style={{ color: "var(--color-neutral-500)", marginTop: "var(--space-1)" }}>
              {format(new Date(order.createdAt), "MMMM d, yyyy 'at' h:mm a")}
            </p>
          </div>
          <div className={`badge badge-${order.status === 'COMPLETED' ? 'completed' : order.status === 'CANCELLED' ? 'cancelled' : 'pending'}`} style={{ fontSize: "var(--text-sm)", padding: "var(--space-2) var(--space-4)" }}>
            {order.status.replace(/_/g, " ")}
          </div>
        </div>
        
        {order.isPossibleDuplicate && (
          <div style={{ marginTop: "var(--space-4)", padding: "var(--space-3)", background: "rgb(245 158 11 / 0.1)", color: "#d97706", borderRadius: "var(--radius-md)", fontSize: "var(--text-sm)", fontWeight: 600 }}>
            ⚠ Warning: This order was flagged as a potential duplicate.
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--space-6)", alignItems: "start" }}>
        {/* Left Column: Order details */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          
          {/* Items */}
          <div className="card">
            <div className="card-body">
              <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "var(--space-4)" }}>Order Items</h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Price</th>
                    <th>Qty</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item: any) => (
                    <tr key={item.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.productNameSnapshot}</div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                          {[item.variantSnapshot.color, item.variantSnapshot.size].filter(Boolean).join(" / ")}
                        </div>
                      </td>
                      <td>₱{Number(item.unitPriceAtPurchase).toLocaleString()}</td>
                      <td>{item.quantity}</td>
                      <td style={{ fontWeight: 600 }}>₱{(Number(item.unitPriceAtPurchase) * item.quantity).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: "var(--space-6)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--color-neutral-200)", display: "flex", flexDirection: "column", gap: "var(--space-2)", alignItems: "flex-end" }}>
                <div style={{ display: "flex", justifyContent: "space-between", width: "250px", color: "var(--color-neutral-600)" }}>
                  <span>Subtotal</span>
                  <span>₱{Number(order.subtotal).toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", width: "250px", color: "var(--color-neutral-600)" }}>
                  <span>Shipping</span>
                  <span>₱{Number(order.shippingAmount).toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", width: "250px", fontSize: "var(--text-xl)", fontWeight: 700, color: "var(--color-neutral-900)", marginTop: "var(--space-2)" }}>
                  <span>Total</span>
                  <span>₱{Number(order.total).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="card">
            <div className="card-body">
              <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "var(--space-4)" }}>Status History</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                {order.statusHistory.map((hist: any) => (
                  <div key={hist.id} style={{ display: "flex", gap: "var(--space-4)" }}>
                    <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "var(--color-brand-400)", marginTop: "4px" }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{hist.toStatus.replace(/_/g, " ")}</div>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                        {format(new Date(hist.createdAt), "MMM d, yyyy h:mm a")} • by {hist.changedBy}
                      </div>
                      {hist.note && (
                        <div style={{ marginTop: "var(--space-1)", fontSize: "var(--text-sm)", color: "var(--color-neutral-700)", background: "var(--color-neutral-50)", padding: "var(--space-2)", borderRadius: "var(--radius-md)" }}>
                          {hist.note}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Audit trail — every important admin action, including the money
              decisions, which the status history alone does not record. */}
          <div className="card">
            <div className="card-body">
              <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "var(--space-4)" }}>Activity Log</h2>
              {order.auditLogs && order.auditLogs.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                  {order.auditLogs.map((entry: AuditLogEntry) => (
                    <div key={entry.id} style={{ display: "flex", gap: "var(--space-4)" }}>
                      <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "var(--color-neutral-300)", marginTop: "4px" }} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
                          {String(entry.action).replace(/[._]/g, " ")}
                        </div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                          {format(new Date(entry.createdAt), "MMM d, yyyy h:mm a")} • by {entry.actor}
                        </div>
                        {entry.metadata?.note && (
                          <div style={{ marginTop: "var(--space-1)", fontSize: "var(--text-sm)", color: "var(--color-neutral-700)", background: "var(--color-neutral-50)", padding: "var(--space-2)", borderRadius: "var(--radius-md)" }}>
                            {entry.metadata.note}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-400)" }}>No admin activity recorded yet.</p>
              )}
            </div>
          </div>

          {/* Internal notes — staff only. The public order lookup never returns
              this field, so it is safe to keep operational remarks here. */}
          <div className="card">
            <div className="card-body">
              <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "var(--space-3)" }}>Internal Notes</h2>
              <textarea
                className="form-input"
                placeholder="Private notes — packing instructions, call remarks, anything the next staff member should know."
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={4}
                maxLength={2000}
                disabled={!capabilities.updateOrder || notesSaving}
                style={{ minHeight: "100px", resize: "vertical" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "var(--space-3)" }}>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)" }}>
                  {notesDraft.length}/2000 · staff only
                </span>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveNotes}
                  disabled={!capabilities.updateOrder || notesSaving}
                >
                  {notesSaving ? "Saving..." : "Save Note"}
                </button>
              </div>
            </div>
          </div>

        </div>

        {/* Right Column: Customer & Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          
          {/* Actions */}
          {capabilities.updateOrder && transitions.length > 0 ? (
            <div className="card" style={{ border: "2px solid var(--color-brand-200)" }}>
              <div className="card-body">
                <h2 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-3)" }}>Update Status</h2>
                <textarea
                  className="form-input"
                  placeholder="Optional note for the customer..."
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  style={{ marginBottom: "var(--space-4)", minHeight: "80px", resize: "none" }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  {transitions.map((t) => (
                    <button
                      key={t}
                      className={`btn btn-full ${['CANCELLED', 'REJECTED'].includes(t) ? 'btn-danger' : 'btn-primary'}`}
                      onClick={() => handleUpdateStatus(t)}
                      disabled={updating}
                    >
                      Mark as {t.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-body">
                {/* Terminal states legitimately have no next step; an empty
                    card with no explanation reads like a bug. */}
                <h2 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-3)" }}>Update Status</h2>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)" }}>
                  {capabilities.updateOrder
                    ? "No status changes are available from here — this order has reached a terminal state."
                    : "Your role is not allowed to change order status."}
                </p>
              </div>
            </div>
          )}

          {/* Customer */}
          <div className="card">
            <div className="card-body">
              <h2 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-3)" }}>Customer Details</h2>
              {customerRestricted && (
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-600)", background: "var(--color-neutral-50)", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-3)" }}>
                  🔒 Contact details are withheld for your role. An admin holding the{" "}
                  <code>customers.read</code> permission can view them.
                </p>
              )}
              <div style={{ fontSize: "var(--text-sm)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <div><strong>Name:</strong> {customerInfo.fullName}</div>
                <div><strong>Phone:</strong> {customerInfo.mobileNumber}</div>
                {customerInfo.email && <div><strong>Email:</strong> {customerInfo.email}</div>}
                {customerInfo.instagramHandle && <div><strong>IG:</strong> {customerInfo.instagramHandle}</div>}
              </div>
            </div>
          </div>

          {/* Delivery */}
          <div className="card">
            <div className="card-body">
              <h2 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-3)" }}>Delivery Info</h2>
              <div style={{ fontSize: "var(--text-sm)" }}>
                <p><strong>Type:</strong> {deliveryInfo.type}</p>
                {deliveryInfo.type === "DELIVERY" && (
                  <p style={{ marginTop: "var(--space-2)" }}>
                    {deliveryInfo.address}<br />
                    {deliveryInfo.city}, {deliveryInfo.province} {deliveryInfo.zipCode}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Payment */}
          <div className="card">
            <div className="card-body">
              <h2 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-3)" }}>Payment</h2>
              <div style={{ fontSize: "var(--text-sm)" }}>
                <p><strong>Method:</strong> {order.paymentMethod.name}</p>
                <p><strong>Status:</strong> {String(order.paymentStatus).replace(/_/g, " ")}</p>
              </div>

              {order.proofs && order.proofs.length > 0 && (
                <div style={{ marginTop: "var(--space-4)" }}>
                  <strong>Proof of Payment:</strong>
                  <div style={{ marginTop: "var(--space-2)" }}>
                    {order.proofs.map((proof: any) => (
                      // Streamed by the guarded admin route. The stored key is
                      // not a URL: proofs live outside public/ because they are
                      // screenshots of a customer's banking app.
                      <a key={proof.id} href={proofUrl(proof.fileKey)} target="_blank" rel="noreferrer" style={{ display: "block", marginBottom: "var(--space-2)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={proofUrl(proof.fileKey)} alt="Proof of payment" style={{ width: "100%", borderRadius: "var(--radius-md)", border: "1px solid var(--color-neutral-200)" }} />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {paymentActions.length > 0 && (
                <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--color-neutral-200)" }}>
                  <h3 style={{ fontSize: "var(--text-sm)", fontWeight: 700, marginBottom: "var(--space-2)" }}>Verify Payment</h3>
                  <textarea
                    className="form-input"
                    placeholder="Optional note for the audit trail..."
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                    style={{ marginBottom: "var(--space-3)", minHeight: "60px", resize: "none" }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    {paymentActions.map((action) => (
                      <button
                        key={action}
                        className={`btn btn-full ${action === "REJECT" ? "btn-danger" : "btn-primary"}`}
                        onClick={() => handlePaymentAction(action)}
                        disabled={updating}
                        title={PAYMENT_ACTIONS[action].hint}
                      >
                        {PAYMENT_ACTIONS[action].label}
                      </button>
                    ))}
                  </div>
                  <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)", marginTop: "var(--space-2)" }}>
                    Money and fulfilment are tracked separately — verifying a payment does not move the order.
                  </p>
                </div>
              )}
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
