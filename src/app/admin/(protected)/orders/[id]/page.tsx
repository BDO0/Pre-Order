"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { getValidNextStatuses } from "@/lib/order-state-machine";
import type { OrderStatus } from "@prisma/client";

export default function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [statusNote, setStatusNote] = useState("");

  const fetchOrder = async () => {
    try {
      const res = await fetch(`/api/admin/orders/${id}`);
      if (!res.ok) throw new Error("Failed to load order");
      const json = await res.json();
      setOrder(json.data);
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
    try {
      const res = await fetch(`/api/admin/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, note: statusNote || undefined }),
      });
      const json = await res.json();
      
      if (!res.ok) throw new Error(json.error?.message || "Failed to update status");
      
      setStatusNote("");
      fetchOrder(); // Reload
    } catch (err: any) {
      alert(err.message);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return <div>Loading order...</div>;
  if (error) return <div style={{ color: "red" }}>{error}</div>;
  if (!order) return <div>Order not found.</div>;

  const customerInfo = order.customerSnapshot as any;
  const deliveryInfo = order.deliverySnapshot as any;

  // Available transitions are derived from the SAME state machine the API
  // enforces. This used to be a second, hand-maintained table that disagreed
  // with the server: it offered transitions the API rejects with a 422 (e.g.
  // CONFIRMED -> SHIPPED) and offered none at all for AWAITING_PAYMENT, which
  // left those orders with no possible next action. Derive, never duplicate.
  const transitions = getValidNextStatuses(order.status as OrderStatus);

  return (
    <div>
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

        </div>

        {/* Right Column: Customer & Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          
          {/* Actions */}
          {transitions.length > 0 && (
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
          )}

          {/* Customer */}
          <div className="card">
            <div className="card-body">
              <h2 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-3)" }}>Customer Details</h2>
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
                <p><strong>Status:</strong> {order.paymentStatus}</p>
              </div>
              {order.proofs && order.proofs.length > 0 && (
                <div style={{ marginTop: "var(--space-4)" }}>
                  <strong>Proof of Payment:</strong>
                  <div style={{ marginTop: "var(--space-2)" }}>
                    {order.proofs.map((proof: any) => (
                      <a key={proof.id} href={proof.fileKey} target="_blank" rel="noreferrer" style={{ display: "block", marginBottom: "var(--space-2)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={proof.fileKey} alt="Proof" style={{ width: "100%", borderRadius: "var(--radius-md)", border: "1px solid var(--color-neutral-200)" }} />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
