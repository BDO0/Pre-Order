"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { format } from "date-fns";

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
        ...(search && { search }),
        ...(statusFilter && { status: statusFilter }),
      });
      const res = await fetch(`/api/admin/orders?${params}`);
      const json = await res.json();
      if (res.ok) {
        setOrders(json.data.orders);
        setTotalPages(json.data.pagination.totalPages);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [page, search, statusFilter]);

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      PENDING: "badge-pending",
      PAYMENT_REVIEW: "badge-coming",
      CONFIRMED: "badge-confirmed",
      PROCESSING: "badge-confirmed",
      READY: "badge-confirmed",
      SHIPPED: "badge-confirmed",
      COMPLETED: "badge-completed",
      CANCELLED: "badge-cancelled",
      REJECTED: "badge-cancelled",
    };
    return `badge ${map[status] || "badge-closed"}`;
  };

  return (
    <div>
      <div className="admin-page-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Orders</span>
      </div>

      <div style={{ display: "flex", gap: "var(--space-4)", marginBottom: "var(--space-6)" }}>
        <input
          type="text"
          placeholder="Search by reference, name, or phone..."
          className="form-input"
          style={{ maxWidth: "400px" }}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select
          className="form-input"
          style={{ maxWidth: "200px" }}
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="PAYMENT_REVIEW">Payment Review</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="PROCESSING">Processing</option>
          <option value="READY">Ready for Pickup</option>
          <option value="SHIPPED">Shipped</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      <div className="table-wrapper">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Customer</th>
                <th>Campaign</th>
                <th>Items</th>
                <th>Total</th>
                <th>Status</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "var(--space-8)" }}>Loading...</td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-neutral-500)" }}>No orders found</td>
                </tr>
              ) : orders.map((order) => {
                const customer = order.customerSnapshot as any;
                const itemCount = order.items.reduce((sum: number, item: any) => sum + item.quantity, 0);
                
                return (
                  <tr key={order.id}>
                    <td style={{ fontWeight: 700, fontFamily: "var(--font-display)" }}>
                      {order.reference}
                      {order.isPossibleDuplicate && <span style={{ color: "var(--color-warning)", marginLeft: "4px" }} title="Possible duplicate">⚠</span>}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--color-neutral-900)" }}>{customer.fullName}</div>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>{customer.mobileNumber}</div>
                    </td>
                    <td>{order.campaign.name}</td>
                    <td>{itemCount} item{itemCount !== 1 ? 's' : ''}</td>
                    <td style={{ fontWeight: 600 }}>₱{Number(order.total).toLocaleString()}</td>
                    <td>
                      <span className={getStatusBadge(order.status)}>
                        {order.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                      {format(new Date(order.createdAt), "MMM d, yyyy h:mm a")}
                    </td>
                    <td>
                      <Link href={`/admin/orders/${order.id}`} className="btn btn-ghost btn-sm">View</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: "var(--space-2)", marginTop: "var(--space-6)" }}>
          <button 
            className="btn btn-secondary btn-sm" 
            disabled={page === 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span style={{ display: "flex", alignItems: "center", fontSize: "var(--text-sm)", color: "var(--color-neutral-600)" }}>
            Page {page} of {totalPages}
          </span>
          <button 
            className="btn btn-secondary btn-sm" 
            disabled={page === totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
