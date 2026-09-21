"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import type { OrderStatus, PaymentStatus } from "@prisma/client";

/**
 * A row of the order queue, as `GET /api/admin/orders` returns it.
 *
 * The endpoint sends the whole order plus the batch and a two-field customer
 * projection; only the columns this table renders are named. Keeping
 * `customerSnapshot` as `unknown` is the point: it is a JSONB column of
 * arbitrary keys, so it is narrowed at the point of use rather than trusted.
 */
interface AdminOrderRow {
  id: string;
  reference: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  /** Prisma `Decimal` reaches the browser as a string; rendered via `Number()`. */
  total: string | number;
  createdAt: string;
  isNewCustomer: boolean;
  isPossibleDuplicate: boolean;
  customerSnapshot: unknown;
  batch: { id: string; name: string; slug: string; status: string } | null;
  items: { quantity: number; productNameSnapshot: string; unitPriceAtPurchase: string | number }[];
}

export default function AdminOrdersPage() {
  const searchParams = useSearchParams();
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  // Read from the URL so the dashboard's action items and the Batches screen can
  // deep-link straight into a filtered queue: "orders not in a batch", "unpaid
  // first-time customers", "this batch".
  const [batchFilter] = useState(searchParams.get("batchId") ?? "");
  const [paymentFilter] = useState(searchParams.get("paymentStatus") ?? "");
  const [customerTypeFilter] = useState(searchParams.get("customerType") ?? "");

  const filterDescriptions: string[] = [];
  if (batchFilter) {
    // Always "in one batch": an order with no batch is not a state the database
    // allows (`Order.batchId` is required), so there is no other phrasing to pick.
    filterDescriptions.push("in one batch");
  }
  if (paymentFilter) filterDescriptions.push(paymentFilter === "UNPAID" ? "unpaid" : "paid");
  if (customerTypeFilter === "new") filterDescriptions.push("first-time customers");

  // The export must carry the same filters the table is showing, or the file
  // would silently disagree with the screen it was downloaded from.
  const exportHref = (() => {
    const params = new URLSearchParams();
    if (batchFilter) params.set("batchId", batchFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (paymentFilter) params.set("paymentStatus", paymentFilter);
    if (customerTypeFilter) params.set("customerType", customerTypeFilter);
    const query = params.toString();
    return `/api/admin/orders/export${query ? `?${query}` : ""}`;
  })();

  // The queue is loaded from inside the effect, where its inputs live: every
  // filter that goes into the query is a dependency, so the loader is re-created
  // and re-run exactly when one of them changes, and nothing has to be silenced
  // to keep the linter happy.
  //
  // `loading` is not set back to `true` on a re-fetch. It starts `true`, so the
  // first paint still says "Loading…", and a filter change keeps the previous
  // rows on screen for the moment it takes to answer — steadier than throwing
  // the table away on every keystroke, and it keeps the only state write out of
  // the synchronous part of the effect, which is the cascading render React
  // warns about.
  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: "20",
          ...(search && { search }),
          ...(statusFilter && { status: statusFilter }),
          ...(batchFilter && { batchId: batchFilter }),
          ...(paymentFilter && { paymentStatus: paymentFilter }),
          ...(customerTypeFilter && { customerType: customerTypeFilter }),
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

    void fetchOrders();
  }, [page, search, statusFilter, batchFilter, paymentFilter, customerTypeFilter]);

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
        <a href={exportHref} className="btn btn-secondary btn-sm">
          ⬇ Export CSV
        </a>
      </div>

      {filterDescriptions.length > 0 && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-600)", marginBottom: "var(--space-3)" }}>
          Showing {filterDescriptions.join(" · ")}.{" "}
          <Link href="/admin/orders" className="btn btn-ghost btn-sm">Clear filters</Link>
        </p>
      )}

      <div style={{ display: "flex", gap: "var(--space-4)", marginBottom: "var(--space-6)" }}>
        <input
          type="text"
          placeholder="Search by reference, name, or Instagram handle..."
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
                <th>Batch / Drop</th>
                <th>Items</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: "var(--space-8)" }}>Loading...</td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-neutral-500)" }}>No orders found</td>
                </tr>
              ) : orders.map((order) => {
                const snapshot = order.customerSnapshot as {
                  fullName?: string;
                  instagramHandle?: unknown;
                };
                const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
                const isPaid = order.paymentStatus === "PAID";
                const handle = typeof snapshot?.instagramHandle === "string" ? snapshot.instagramHandle : null;

                return (
                  <tr key={order.id}>
                    <td style={{ fontWeight: 700, fontFamily: "var(--font-display)" }}>
                      {order.reference}
                      {order.isPossibleDuplicate && <span style={{ color: "var(--color-warning)", marginLeft: "4px" }} title="Possible duplicate">⚠</span>}
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                        <span style={{ fontWeight: 600, color: "var(--color-neutral-900)" }}>{snapshot.fullName}</span>
                        {/* OG vs NEW decides the tone of the DM: a first-timer
                            needs the payment conversation, a regular usually does not. */}
                        <span
                          className={`badge ${order.isNewCustomer ? "badge-coming" : "badge-confirmed"}`}
                          title={order.isNewCustomer ? "First order from this account" : "Has ordered before"}
                        >
                          {order.isNewCustomer ? "NEW" : "OG"}
                        </span>
                      </div>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                        {handle ? `@${handle}` : "no Instagram handle"}
                      </div>
                    </td>
                    <td>
                      {order.batch ? (
                        <span style={{ fontWeight: 500 }}>{order.batch.name}</span>
                      ) : (
                        <span style={{ color: "var(--color-warning)", fontSize: "var(--text-xs)", fontWeight: 600 }}>
                          unassigned
                        </span>
                      )}
                    </td>
                    <td>{itemCount} item{itemCount !== 1 ? 's' : ''}</td>
                    <td style={{ fontWeight: 600 }}>₱{Number(order.total).toLocaleString()}</td>
                    <td>
                      <span className={`badge ${isPaid ? "badge-confirmed" : "badge-pending"}`}>
                        {isPaid ? "PAID" : "UNPAID"}
                      </span>
                    </td>
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
