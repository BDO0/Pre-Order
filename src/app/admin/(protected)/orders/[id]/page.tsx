"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { getValidNextStatuses } from "@/lib/order-state-machine";
import { toggleFor } from "@/lib/payment-state-machine";
import { REDACTED_FIELD, isRedacted } from "@/lib/redaction";
import { formatInstagramHandle, instagramProfileUrl } from "@/lib/instagram";
import { readSnapshotAnswers, snapshotFullName } from "@/lib/order-answers";
import { describeEta } from "@/lib/batches";
import type { OrderStatus, PaymentStatus } from "@prisma/client";

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

/** One row of the status history. */
interface StatusHistoryEntry {
  id: string;
  toStatus: string;
  changedBy: string;
  note: string | null;
  createdAt: string;
}

/** One line item. The snapshots are what the customer saw when they ordered. */
interface OrderItemRow {
  id: string;
  productNameSnapshot: string;
  variantSnapshot: unknown;
  unitPriceAtPurchase: string | number;
  quantity: number;
}

/**
 * The order screen's payload, as `GET /api/admin/orders/[id]` returns it.
 *
 * Dates are typed as strings rather than `Date`s on purpose: this arrives as
 * JSON, so claiming they are `Date` objects would be a comfortable lie that
 * breaks the first time anything but `new Date(value)` touches one. The money
 * columns are `Decimal` server-side and arrive as strings, which is why every
 * one of them is read through `Number()`.
 */
interface OrderDetail {
  reference: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  createdAt: string;
  subtotal: string | number;
  total: string | number;
  isNewCustomer: boolean;
  isPossibleDuplicate: boolean;
  customerSnapshot: unknown;
  items: OrderItemRow[];
  statusHistory: StatusHistoryEntry[];
  auditLogs?: AuditLogEntry[];
  customer: { instagramHandle: string | null; _count?: { orders: number } } | null;
  /** `endAt` arrives renamed to `etaAt` — the operator's word for the same date. */
  batch: { id: string; name: string; slug: string; status: string; etaAt: string | null } | null;
  /** Shipped only when the viewer may act; absent means no buttons are rendered. */
  allowedTransitions?: OrderStatus[];
  capabilities?: OrderCapabilities;
}

/** Colour + size of a line item, read defensively from the JSONB snapshot. */
function variantLabel(snapshot: unknown): string {
  const variant = (snapshot ?? {}) as { color?: string; size?: string };
  return [variant.color, variant.size].filter(Boolean).join(" / ");
}

export default function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  // Batches: the list for the picker, and the pending choice.
  const [batches, setBatches] = useState<{ id: string; name: string; etaAt: string | null }[]>([]);
  const [batchDraft, setBatchDraft] = useState<string>("");
  const [batchSaving, setBatchSaving] = useState(false);

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
      // Seed the batch picker from what the order currently says, so an
      // untouched form cannot change anything.
      setBatchDraft(json.data?.batch?.id ?? "");
      // Re-seed the notes box from the stored value on every load, so it can
      // never show a draft that has already been superseded. Deliberately inside
      // this async callback rather than an effect body: setting state directly
      // in an effect causes a cascading render.
      setNotesDraft(json.data?.notes ?? "");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load order");
    } finally {
      setLoading(false);
    }
  };

  /** The batches available for grouping. Loaded once; the list rarely changes. */
  const fetchBatches = async () => {
    try {
      const res = await fetch("/api/admin/batches");
      if (!res.ok) return;
      const json = await res.json();
      setBatches(json.data ?? []);
    } catch {
      // A failed picker load is not worth an error banner: the order screen is
      // still fully usable, and the operator can reassign from Batches.
    }
  };

  useEffect(() => {
    // Both loaders set state from their own promise callbacks, never
    // synchronously here — the rule cannot see through an async function
    // defined above. `fetchOrder` has to stay outside: the mutation handlers
    // below call it again to reload after a status, payment, notes or batch
    // change, so copying it into this effect would duplicate the parser for
    // every one of those responses.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchOrder();
    void fetchBatches();
    // Both loaders are re-created on every render and each writes to state;
    // listing them would re-fetch in a loop. `id` is the real input, and it is
    // the one that changes when the operator opens a different order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /**
   * Saves the batch assignment.
   *
   * Its own request rather than part of the status PATCH: grouping orders into a
   * supplier run is a different task from moving one through fulfilment, and the
   * API keeps them apart so the audit trail never confuses the two.
   */
  const handleBatchChange = async (nextBatchId: string) => {
    setBatchSaving(true);
    setActionError("");
    try {
      const res = await fetch(`/api/admin/orders/${id}/batch`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: nextBatchId === "" ? null : nextBatchId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to update the batch");

      await fetchOrder();
      flash(
        json.data?.batch
          ? `Added to ${json.data.batch.name}.`
          : "Removed from its batch."
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update the batch");
    } finally {
      setBatchSaving(false);
    }
  };

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
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setUpdating(false);
    }
  };

  /**
   * The Paid / Unpaid toggle.
   *
   * One request, one boolean, and it changes `paymentStatus` only — recording
   * that money arrived never silently moves the order through fulfilment.
   */
  const handlePaymentToggle = async (paid: boolean) => {
    setUpdating(true);
    setActionError("");
    try {
      const res = await fetch(`/api/admin/orders/${id}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paid, note: paymentNote || undefined }),
      });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error?.message || "Failed to update payment");

      setPaymentNote("");
      await fetchOrder();
      flash(
        json.data?.changed === false
          ? `Already marked as ${paid ? "paid" : "unpaid"}.`
          : `${toggleFor(paid).label} recorded.`
      );
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

  const customerInfo = order.customerSnapshot as Record<string, unknown>;
  const customerName = snapshotFullName(customerInfo) ?? "—";
  const answers = readSnapshotAnswers(customerInfo);

  // The API ships the decisions; the UI only renders them. `allowedTransitions`
  // arrives already filtered by this admin's permissions, so a VIEWER is never
  // shown a button the API would answer with a 403.
  const capabilities: OrderCapabilities = order.capabilities ?? {
    updateOrder: false,
    verifyPayment: false,
    readCustomer: false,
  };
  const transitions: OrderStatus[] =
    order.allowedTransitions ?? getValidNextStatuses(order.status as OrderStatus);
  const isPaid = String(order.paymentStatus) === "PAID";
  // A role without `customers.read` receives the handle as the redaction marker;
  // recognising that is how the banner knows to explain itself.
  const customerRestricted =
    !capabilities.readCustomer || isRedacted(customerInfo?.instagramHandle);

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
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.productNameSnapshot}</div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                          {variantLabel(item.variantSnapshot)}
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
                {/* There is no shipping line, because there is no shipping
                    charge: the order service computes `total = subtotal` and
                    shipping is settled in Instagram DM. This row used to print
                    `order.shippingAmount` — a column the schema does not have —
                    so every order read "Shipping ₱NaN". */}
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
                {order.statusHistory.map((hist) => (
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
                  {order.auditLogs.map((entry) => (
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
              <h2 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-3)" }}>Customer</h2>
              {customerRestricted && (
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-600)", background: "var(--color-neutral-50)", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-3)" }}>
                  🔒 Contact details are withheld for your role. An admin holding the{" "}
                  <code>customers.read</code> permission can view them.
                </p>
              )}
              <div style={{ fontSize: "var(--text-sm)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)" }}>
                  <span><strong>Name:</strong> {customerName}</span>
                  {/* The badge that decides how this order is read: a first-timer
                      needs a nudge, a regular needs their usual. */}
                  <span
                    className={`badge ${order.isNewCustomer ? "badge-coming" : "badge-confirmed"}`}
                    title={order.isNewCustomer ? "First order from this account" : "Has ordered before"}
                  >
                    {order.isNewCustomer ? "NEW" : "OG"}
                  </span>
                </div>
                <div>
                  <strong>Instagram:</strong>{" "}
                  {customerRestricted ? (
                    <span style={{ color: "var(--color-neutral-500)" }}>{REDACTED_FIELD}</span>
                  ) : typeof customerInfo?.instagramHandle === "string" && customerInfo.instagramHandle ? (
                    <a
                      href={instagramProfileUrl(customerInfo.instagramHandle)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "var(--color-brand-600)", fontWeight: 600 }}
                    >
                      {formatInstagramHandle(customerInfo.instagramHandle)} ↗
                    </a>
                  ) : (
                    <span style={{ color: "var(--color-neutral-400)" }}>not recorded</span>
                  )}
                </div>
                {typeof order.customer?.instagramHandle === "string" && (
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                    {order.customer._count?.orders ?? 0} order
                    {(order.customer._count?.orders ?? 0) === 1 ? "" : "s"} from this account in total
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* What the customer answered. Label + value: the label is the one that
              was on screen when they ordered, so renaming a field cannot
              rewrite history and deleting one cannot turn this into a mystery. */}
          <div className="card">
            <div className="card-body">
              <h2 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-3)" }}>Their Details</h2>
              {answers.length === 0 ? (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-400)" }}>
                  No extra questions were answered on this order.
                </p>
              ) : (
                <div style={{ fontSize: "var(--text-sm)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  {answers.map((answer) => (
                    <div key={answer.key}>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", marginBottom: "2px" }}>
                        {answer.label}
                      </div>
                      <div
                        style={{
                          fontWeight: 600,
                          color: isRedacted(answer.value) ? "var(--color-neutral-500)" : "var(--color-neutral-900)",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {answer.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Batch — which supplier run this order belongs to, and when it is
              expected. The ETA is the answer to the question customers actually
              ask in the DM, so it is shown right here next to the customer. */}
          <div className="card">
            <div className="card-body">
              <h2 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-3)" }}>Batch</h2>

              {order.batch ? (
                <div style={{ fontSize: "var(--text-sm)", marginBottom: "var(--space-3)" }}>
                  <div style={{ fontWeight: 600 }}>{order.batch.name}</div>
                  <div style={{ color: "var(--color-neutral-500)" }}>
                    {order.batch.etaAt
                      ? `Expected ${format(new Date(order.batch.etaAt), "MMM d, yyyy")}`
                      : "No ETA set yet"}
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)", marginTop: "var(--space-1)" }}>
                    {describeEta(order.batch.etaAt)}
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-warning)", marginBottom: "var(--space-3)" }}>
                  ⚠ Not in a batch yet — this order is not part of a supplier run.
                </p>
              )}

              {capabilities.updateOrder ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  <select
                    className="form-input"
                    value={batchDraft}
                    onChange={(e) => setBatchDraft(e.target.value)}
                    disabled={batchSaving || batches.length === 0}
                  >
                    {/* A placeholder, not a choice: an order always belongs to a batch
                        (`Order.batchId` is required) and a batch with orders cannot be
                        deleted, so "remove it from its run" is not an action this app
                        can perform. */}
                    <option value="">{batches.length === 0 ? "No batches exist yet" : "Choose a batch…"}</option>
                    {batches.map((batch) => (
                      <option key={batch.id} value={batch.id}>{batch.name}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleBatchChange(batchDraft)}
                    disabled={batchSaving || batchDraft === (order.batch?.id ?? "")}
                  >
                    {batchSaving ? "Saving…" : "Save batch"}
                  </button>
                  <Link href="/admin/batches" className="btn btn-ghost btn-sm">
                    Manage batches
                  </Link>
                </div>
              ) : (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)" }}>
                  🔒 Your role cannot change the batch.
                </p>
              )}
            </div>
          </div>

          {/* Payment — the entire payment model: one switch. */}
          <div className="card" style={{ border: isPaid ? "2px solid var(--color-success)" : "2px solid var(--color-warning)" }}>
            <div className="card-body">
              <h2 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-3)" }}>Payment</h2>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
                <span
                  className={`badge ${isPaid ? "badge-confirmed" : "badge-pending"}`}
                  style={{ fontSize: "var(--text-sm)", padding: "var(--space-1) var(--space-3)" }}
                >
                  {isPaid ? "PAID" : "UNPAID"}
                </span>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 700 }}>
                  ₱{Number(order.total).toLocaleString()}
                </span>
              </div>

              <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", marginBottom: "var(--space-4)" }}>
                Payment is settled in Instagram DM. Flip this switch once the money is
                actually in — it only records what you already know.
              </p>

              {capabilities.verifyPayment ? (
                <>
                  <textarea
                    className="form-input"
                    placeholder="Optional note for the audit trail (GCash ref, date settled…)"
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                    style={{ marginBottom: "var(--space-3)", minHeight: "60px", resize: "none" }}
                    maxLength={500}
                  />
                  <button
                    type="button"
                    className={`btn btn-full ${isPaid ? "btn-secondary" : "btn-primary"}`}
                    onClick={() => handlePaymentToggle(!isPaid)}
                    disabled={updating}
                    title={toggleFor(!isPaid).hint}
                  >
                    {updating ? "Saving…" : toggleFor(!isPaid).label}
                  </button>
                  <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)", marginTop: "var(--space-2)" }}>
                    Payment and fulfilment are tracked separately — this never moves the
                    order.
                  </p>
                </>
              ) : (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)" }}>
                  🔒 Your role cannot record payments (<code>payments.verify</code>).
                </p>
              )}
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
