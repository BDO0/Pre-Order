"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { getValidNextStatuses } from "@/lib/order-state-machine";
import { REDACTED_FIELD, isRedacted } from "@/lib/redaction";
import { formatInstagramHandle, instagramProfileUrl } from "@/lib/instagram";
import { snapshotFullName } from "@/lib/order-answers";
import type { OrderStatus, PaymentStatus } from "@prisma/client";
import { parseApiResponse } from "@/lib/api-client";
import adminStyles from "../../admin.module.css";

interface OrderCapabilities {
  updateOrder: boolean;
  verifyPayment: boolean;
  readCustomer: boolean;
}

interface AuditLogEntry {
  id: string;
  action: string;
  actor: string;
  createdAt: string;
  metadata?: { note?: string | null } | null;
}

interface StatusHistoryEntry {
  id: string;
  toStatus: string;
  changedBy: string;
  note: string | null;
  createdAt: string;
}

interface OrderItemRow {
  id: string;
  productNameSnapshot: string;
  variantSnapshot: unknown;
  unitPriceAtPurchase: string | number;
  quantity: number;
}

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
  batch: { id: string; name: string; slug: string; status: string; etaAt: string | null } | null;
  allowedTransitions?: OrderStatus[];
  capabilities?: OrderCapabilities;
}

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
  const [activeTab, setActiveTab] = useState<"details" | "activity">("details");

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
      const { ok, data, error: errText } = await parseApiResponse(res, "Failed to load order");
      if (!ok || !data) throw new Error(errText || "Failed to load order");
      setOrder(data);
      setBatchDraft(data?.batch?.id ?? "");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load order");
    } finally {
      setLoading(false);
    }
  };

  const fetchBatches = async () => {
    try {
      const res = await fetch("/api/admin/batches");
      const { ok, data } = await parseApiResponse(res);
      if (ok && data) setBatches(data);
    } catch {
    }
  };

  useEffect(() => {
    void fetchOrder();
    void fetchBatches();
  }, [id]);

  const handleConfirmAndPay = async () => {
    if (!order) return;
    const prevOrder = order;
    const nextTransitions = getValidNextStatuses("CONFIRMED");

    setOrder((current) => {
      if (!current) return null;
      return {
        ...current,
        status: "CONFIRMED",
        paymentStatus: "PAID",
        allowedTransitions: nextTransitions,
        statusHistory: [
          ...current.statusHistory,
          {
            id: `temp-${Date.now()}`,
            toStatus: "CONFIRMED",
            changedBy: "you (just now)",
            note: "Confirmed & payment recorded",
            createdAt: new Date().toISOString(),
          },
        ],
      };
    });
    flash("Order confirmed and marked as paid.");
    setUpdating(true);
    setActionError("");

    try {
      const res = await fetch(`/api/admin/orders/${id}/confirm-and-pay`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Confirmed & payment recorded" }),
      });
      const { ok, error: err } = await parseApiResponse(res, "Failed to confirm order");
      if (!ok) throw new Error(err || "Failed to confirm order");
    } catch (err) {
      setOrder(prevOrder);
      setNotice("");
      setActionError(err instanceof Error ? err.message : "Failed to confirm order");
    } finally {
      setUpdating(false);
    }
  };

  const handleBatchChange = async (nextBatchId: string) => {
    if (!order) return;
    const prevBatch = order.batch;
    const chosenBatch = batches.find((b) => b.id === nextBatchId);

    setOrder((current) => {
      if (!current) return null;
      return {
        ...current,
        batch: chosenBatch ? { ...chosenBatch, slug: "", status: "OPEN" } : null,
      };
    });
    flash(chosenBatch ? `Assigned to ${chosenBatch.name}.` : "Removed from batch.");
    setBatchSaving(true);
    setActionError("");

    try {
      const res = await fetch(`/api/admin/orders/${id}/batch`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: nextBatchId === "" ? null : nextBatchId }),
      });
      const { ok, error: err } = await parseApiResponse(res, "Failed to update the batch");
      if (!ok) throw new Error(err || "Failed to update the batch");
    } catch (err) {
      setOrder((current) => (current ? { ...current, batch: prevBatch } : null));
      setNotice("");
      setActionError(err instanceof Error ? err.message : "Failed to update the batch");
    } finally {
      setBatchSaving(false);
    }
  };

  const handleUpdateStatus = async (newStatus: string) => {
    if (!order) return;
    const prevOrder = order;
    const nextTransitions = getValidNextStatuses(newStatus as OrderStatus);

    setOrder((current) => {
      if (!current) return null;
      return {
        ...current,
        status: newStatus as OrderStatus,
        allowedTransitions: nextTransitions,
        statusHistory: [
          ...current.statusHistory,
          {
            id: `temp-${Date.now()}`,
            toStatus: newStatus,
            changedBy: "you (just now)",
            note: null,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    });
    flash(`Order marked as ${newStatus.replace(/_/g, " ")}.`);
    setUpdating(true);
    setActionError("");

    try {
      const res = await fetch(`/api/admin/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const { ok, error: err } = await parseApiResponse(res, "Failed to update status");
      if (!ok) throw new Error(err || "Failed to update status");
    } catch (err: unknown) {
      setOrder(prevOrder);
      setNotice("");
      setActionError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setUpdating(false);
    }
  };

  const handlePaymentToggle = async (paid: boolean) => {
    if (!order) return;
    const prevOrder = order;

    setOrder((current) => {
      if (!current) return null;
      return {
        ...current,
        paymentStatus: paid ? "PAID" : "UNPAID",
      };
    });
    flash(paid ? "Payment marked as paid." : "Payment marked as unpaid.");
    setUpdating(true);
    setActionError("");

    try {
      const res = await fetch(`/api/admin/orders/${id}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paid }),
      });
      const { ok, error: err } = await parseApiResponse(res, "Failed to update payment");
      if (!ok) throw new Error(err || "Failed to update payment");
    } catch (err) {
      setOrder(prevOrder);
      setNotice("");
      setActionError(err instanceof Error ? err.message : "Failed to update payment");
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return <div style={{ padding: "var(--space-6)", color: "var(--color-neutral-500)" }}>Loading order...</div>;
  if (error) return <div style={{ padding: "var(--space-6)", color: "var(--color-error)" }}>{error}</div>;
  if (!order) return <div style={{ padding: "var(--space-6)" }}>Order not found.</div>;

  const customerInfo = order.customerSnapshot as Record<string, unknown>;
  const customerName = snapshotFullName(customerInfo) ?? "—";

  const capabilities: OrderCapabilities = order.capabilities ?? {
    updateOrder: false,
    verifyPayment: false,
    readCustomer: false,
  };
  const transitions: OrderStatus[] =
    order.allowedTransitions ?? getValidNextStatuses(order.status as OrderStatus);
  const isPaid = String(order.paymentStatus) === "PAID";
  const customerRestricted =
    !capabilities.readCustomer || isRedacted(customerInfo?.instagramHandle);

  const totalActivityCount = (order.statusHistory?.length || 0) + (order.auditLogs?.length || 0);

  return (
    <div>
      {notice && (
        <div style={{ padding: "var(--space-3) var(--space-4)", background: "rgb(22 163 74 / 0.08)", border: "1px solid rgb(22 163 74 / 0.3)", borderRadius: "var(--radius-lg)", color: "var(--color-success)", fontWeight: 500, marginBottom: "var(--space-4)" }}>
          {notice}
        </div>
      )}
      {actionError && (
        <div role="alert" style={{ padding: "var(--space-3) var(--space-4)", background: "rgb(220 38 38 / 0.08)", border: "1px solid rgb(220 38 38 / 0.3)", borderRadius: "var(--radius-lg)", color: "var(--color-error)", fontWeight: 500, marginBottom: "var(--space-4)" }}>
          {actionError}
        </div>
      )}

      <div style={{ marginBottom: "var(--space-5)" }}>
        <Link href="/butigadmin/orders" style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", textDecoration: "none", fontWeight: 500 }}>
          Back to Orders
        </Link>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: "var(--space-2)", flexWrap: "wrap", gap: "var(--space-4)" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <h1 className="admin-page-title" style={{ marginBottom: 0, fontSize: "var(--text-2xl)", fontWeight: 700 }}>
                {customerName}
              </h1>
            </div>
            <div style={{ color: "var(--color-neutral-500)", marginTop: "var(--space-1)", fontSize: "var(--text-sm)", display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ 
                fontFamily: "var(--font-mono)", 
                fontSize: "var(--text-xs)", 
                background: "var(--color-neutral-100)", 
                padding: "2px 8px", 
                borderRadius: "var(--radius-md)", 
                color: "var(--color-neutral-700)", 
                fontWeight: 600 
              }}>
                {order.reference}
              </span>
              <span>•</span>
              <span>{format(new Date(order.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
              {order.customer?.instagramHandle && (
                <>
                  <span>•</span>
                  <a
                    href={instagramProfileUrl(order.customer.instagramHandle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--color-brand-600)", fontWeight: 600, textDecoration: "none" }}
                  >
                    @{formatInstagramHandle(order.customer.instagramHandle)}
                  </a>
                </>
              )}
            </div>
          </div>
          <div className={`badge badge-${order.status === 'COMPLETED' ? 'completed' : order.status === 'CANCELLED' ? 'cancelled' : 'pending'}`} style={{ fontSize: "var(--text-sm)", padding: "var(--space-2) var(--space-4)" }}>
            {order.status.replace(/_/g, " ")}
          </div>
        </div>
        
        {order.isPossibleDuplicate && (
          <div style={{ marginTop: "var(--space-3)", padding: "var(--space-2) var(--space-3)", background: "rgb(245 158 11 / 0.1)", color: "#b45309", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontWeight: 600 }}>
            Warning: This order was flagged as a potential duplicate.
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "var(--space-2)", borderBottom: "1px solid var(--color-neutral-200)", marginBottom: "var(--space-5)" }}>
        <button
          type="button"
          onClick={() => setActiveTab("details")}
          style={{
            padding: "var(--space-2) var(--space-4)",
            background: "none",
            border: "none",
            borderBottom: activeTab === "details" ? "2px solid var(--color-brand-600)" : "2px solid transparent",
            color: activeTab === "details" ? "var(--color-brand-700)" : "var(--color-neutral-500)",
            fontWeight: activeTab === "details" ? 600 : 500,
            fontSize: "var(--text-sm)",
            cursor: "pointer",
            marginBottom: "-1px",
            transition: "all var(--transition-fast)",
          }}
        >
          Order Details
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("activity")}
          style={{
            padding: "var(--space-2) var(--space-4)",
            background: "none",
            border: "none",
            borderBottom: activeTab === "activity" ? "2px solid var(--color-brand-600)" : "2px solid transparent",
            color: activeTab === "activity" ? "var(--color-brand-700)" : "var(--color-neutral-500)",
            fontWeight: activeTab === "activity" ? 600 : 500,
            fontSize: "var(--text-sm)",
            cursor: "pointer",
            marginBottom: "-1px",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            transition: "all var(--transition-fast)",
          }}
        >
          <span>Activity Log</span>
          {totalActivityCount > 0 && (
            <span style={{
              background: activeTab === "activity" ? "var(--color-brand-100)" : "var(--color-neutral-100)",
              color: activeTab === "activity" ? "var(--color-brand-700)" : "var(--color-neutral-600)",
              padding: "1px 6px",
              borderRadius: "var(--radius-full)",
              fontSize: "11px",
              fontWeight: 600,
            }}>
              {totalActivityCount}
            </span>
          )}
        </button>
      </div>

      {activeTab === "details" && (
        <div className={adminStyles.orderDetailGrid}>
          <div>
            <div className="card">
              <div className="card-body">
                <h2 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-4)" }}>
                  Order Items
                </h2>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th style={{ textAlign: "right" }}>Price</th>
                      <th style={{ textAlign: "center" }}>Qty</th>
                      <th style={{ textAlign: "right" }}>Total</th>
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
                        <td style={{ textAlign: "right" }}>₱{Number(item.unitPriceAtPurchase).toLocaleString()}</td>
                        <td style={{ textAlign: "center" }}>{item.quantity}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>₱{(Number(item.unitPriceAtPurchase) * item.quantity).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-neutral-200)", display: "flex", flexDirection: "column", gap: "var(--space-1)", alignItems: "flex-end" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", width: "220px", color: "var(--color-neutral-600)", fontSize: "var(--text-sm)" }}>
                    <span>Subtotal</span>
                    <span>₱{Number(order.subtotal).toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", width: "220px", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-neutral-900)", marginTop: "var(--space-1)" }}>
                    <span>Total</span>
                    <span>₱{Number(order.total).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div className="card">
              <div className="card-body">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
                  <h2 style={{ fontSize: "var(--text-sm)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-neutral-500)", margin: 0 }}>
                    Actions
                  </h2>
                  <span
                    className="badge"
                    style={{
                      background: isPaid ? "#dcfce7" : "#fee2e2",
                      color: isPaid ? "#14532d" : "#991b1b",
                      border: isPaid ? "1px solid #86efac" : "1px solid #fca5a5",
                      fontWeight: 700,
                      fontSize: "var(--text-xs)",
                    }}
                  >
                    {isPaid ? "PAID" : "UNPAID"}
                  </span>
                </div>

                {["PENDING", "AWAITING_PAYMENT", "PAYMENT_REVIEW"].includes(order.status) && !isPaid && capabilities.updateOrder && capabilities.verifyPayment && (
                  <button
                    type="button"
                    className="btn btn-full"
                    style={{
                      background: "var(--color-success)",
                      borderColor: "var(--color-success)",
                      color: "white",
                      fontWeight: 600,
                      fontSize: "var(--text-sm)",
                      padding: "var(--space-3)",
                      marginBottom: "var(--space-3)",
                    }}
                    onClick={handleConfirmAndPay}
                    disabled={updating}
                  >
                    {updating ? "Saving..." : "Approve & Mark as Paid"}
                  </button>
                )}

                {capabilities.updateOrder && (() => {
                  let nextStep: { label: string; status: OrderStatus } | null = null;
                  if (transitions.includes("CONFIRMED")) {
                    nextStep = isPaid
                      ? { label: "Mark as Confirmed", status: "CONFIRMED" }
                      : { label: "Approve Order", status: "CONFIRMED" };
                  } else if (transitions.includes("PROCESSING")) {
                    nextStep = { label: "Move to Production", status: "PROCESSING" };
                  } else if (transitions.includes("READY")) {
                    nextStep = { label: "Mark Ready for Pickup/Delivery", status: "READY" };
                  } else if (transitions.includes("SHIPPED")) {
                    nextStep = { label: "Mark as Shipped", status: "SHIPPED" };
                  } else if (transitions.includes("COMPLETED")) {
                    nextStep = { label: "Mark as Completed", status: "COMPLETED" };
                  }

                  if (!nextStep) return null;
                  return (
                    <button
                      type="button"
                      className="btn btn-primary btn-full"
                      style={{ marginBottom: "var(--space-3)", fontWeight: 600, fontSize: "var(--text-sm)" }}
                      onClick={() => handleUpdateStatus(nextStep.status)}
                      disabled={updating}
                    >
                      {updating ? "Saving..." : nextStep.label}
                    </button>
                  );
                })()}

                {capabilities.verifyPayment && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-2) var(--space-3)", background: "var(--color-neutral-50)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-3)" }}>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-600)" }}>
                      Payment status
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
                      onClick={() => handlePaymentToggle(!isPaid)}
                      disabled={updating}
                    >
                      {isPaid ? "Mark as Unpaid" : "Mark as Paid"}
                    </button>
                  </div>
                )}

                {capabilities.updateOrder && !["CANCELLED", "REJECTED", "COMPLETED"].includes(order.status) && (
                  <div style={{ borderTop: "1px solid var(--color-neutral-100)", paddingTop: "var(--space-2)" }}>
                    {transitions.filter(t => ["CANCELLED", "REJECTED"].includes(t)).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ color: "var(--color-error)", fontSize: "var(--text-xs)", width: "100%", textAlign: "center" }}
                        onClick={() => handleUpdateStatus(t)}
                        disabled={updating}
                      >
                        Cancel Order
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-body">
                <h2 style={{ fontSize: "var(--text-sm)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-neutral-500)", marginBottom: "var(--space-3)" }}>
                  Customer
                </h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", fontSize: "var(--text-sm)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, color: "var(--color-neutral-900)" }}>{customerName}</span>
                  </div>

                  <div>
                    {customerRestricted ? (
                      <span style={{ color: "var(--color-neutral-500)", fontSize: "var(--text-xs)" }}>{REDACTED_FIELD}</span>
                    ) : typeof customerInfo?.instagramHandle === "string" && customerInfo.instagramHandle ? (
                      <a
                        href={instagramProfileUrl(customerInfo.instagramHandle)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--color-brand-600)", fontWeight: 600, fontSize: "var(--text-sm)", textDecoration: "none" }}
                      >
                        @{formatInstagramHandle(customerInfo.instagramHandle)}
                      </a>
                    ) : (
                      <span style={{ color: "var(--color-neutral-400)", fontSize: "var(--text-xs)" }}>No Instagram recorded</span>
                    )}
                  </div>

                  {typeof order.customer?.instagramHandle === "string" && (
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                      {order.customer._count?.orders ?? 0} order{(order.customer._count?.orders ?? 0) === 1 ? "" : "s"} total
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-body">
                <h2 style={{ fontSize: "var(--text-sm)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-neutral-500)", marginBottom: "var(--space-3)" }}>
                  Batch
                </h2>
                {order.batch ? (
                  <div style={{ fontSize: "var(--text-sm)", marginBottom: "var(--space-3)" }}>
                    <div style={{ fontWeight: 600, color: "var(--color-neutral-900)" }}>{order.batch.name}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", marginTop: "2px" }}>
                      {order.batch.etaAt ? `ETA: ${format(new Date(order.batch.etaAt), "MMM d, yyyy")}` : "No ETA set"}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", marginBottom: "var(--space-3)" }}>
                    Not assigned to a batch
                  </div>
                )}

                {capabilities.updateOrder && batches.length > 0 && (
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <select
                      className="form-input"
                      value={batchDraft}
                      onChange={(e) => setBatchDraft(e.target.value)}
                      disabled={batchSaving}
                      style={{ fontSize: "var(--text-xs)", padding: "var(--space-1) var(--space-2)", height: "34px" }}
                    >
                      <option value="">Choose batch...</option>
                      {batches.map((batch) => (
                        <option key={batch.id} value={batch.id}>{batch.name}</option>
                      ))}
                    </select>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleBatchChange(batchDraft)}
                      disabled={batchSaving || batchDraft === (order.batch?.id ?? "")}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {batchSaving ? "Saving..." : "Save"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "activity" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          <div className="card">
            <div className="card-body">
              <h2 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-4)" }}>
                Status History
              </h2>
              {order.statusHistory.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                  {order.statusHistory.map((hist) => (
                    <div key={hist.id} style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
                      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--color-brand-600)", marginTop: "6px", flexShrink: 0 }} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--color-neutral-900)" }}>
                          {hist.toStatus.replace(/_/g, " ")}
                        </div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                          {format(new Date(hist.createdAt), "MMM d, yyyy h:mm a")} • {hist.changedBy}
                        </div>
                        {hist.note && (
                          <div style={{ marginTop: "var(--space-1)", fontSize: "var(--text-xs)", color: "var(--color-neutral-600)", background: "var(--color-neutral-50)", padding: "var(--space-2)", borderRadius: "var(--radius-md)" }}>
                            {hist.note}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-400)" }}>No status history recorded.</p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <h2 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-4)" }}>
                Activity Log
              </h2>
              {order.auditLogs && order.auditLogs.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                  {order.auditLogs.map((entry) => (
                    <div key={entry.id} style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
                      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--color-neutral-400)", marginTop: "6px", flexShrink: 0 }} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--color-neutral-900)" }}>
                          {String(entry.action).replace(/[._]/g, " ")}
                        </div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                          {format(new Date(entry.createdAt), "MMM d, yyyy h:mm a")} • {entry.actor}
                        </div>
                        {entry.metadata?.note && (
                          <div style={{ marginTop: "var(--space-1)", fontSize: "var(--text-xs)", color: "var(--color-neutral-600)", background: "var(--color-neutral-50)", padding: "var(--space-2)", borderRadius: "var(--radius-md)" }}>
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
        </div>
      )}
    </div>
  );
}
