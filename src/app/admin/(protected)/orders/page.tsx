"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import type { OrderStatus, PaymentStatus } from "@prisma/client";
import { parseApiResponse } from "@/lib/api-client";

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
  /**
   * Always present: `Order.batchId` is a required column, so the list endpoint's
   * `include` can never come back null. It was typed nullable here, which is what
   * let an "unassigned" badge sit in this table for a state the database does not
   * allow.
   */
  batch: { id: string; name: string; slug: string; status: string };
  items: { quantity: number; productNameSnapshot: string; unitPriceAtPurchase: string | number }[];
}

/**
 * Every status the queue can be filtered by, with the wording the operator sees.
 *
 * One list rather than the two there used to be: the dropdown's options and the
 * check on what a URL is allowed to ask for. `buildOrderWhere` passes `status`
 * to Prisma as an enum, so `?status=typo` was a 500 rather than the empty list
 * its comment promised. `AWAITING_PAYMENT` was missing from the dropdown
 * altogether, though the state machine can put an order there.
 */
const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: "PENDING", label: "New Orders" },
  { value: "CONFIRMED", label: "Accepted" },
  { value: "CANCELLED", label: "Cancelled" },
];

export default function AdminOrdersPage() {
  const searchParams = useSearchParams();
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  const router = useRouter();
  const pathname = usePathname();

  /**
   * The filters, read from the URL on every render instead of copied into state
   * once.
   *
   * They used to be `useState(searchParams.get(...))` initialisers, which run on
   * mount and never again. "Clear filters" is a link to `/admin/orders` - the
   * same route - so the screen re-rendered with empty search params while the
   * table went on showing the filtered rows and the banner went on saying
   * "Showing unpaid". The URL is the single source of truth now.
   *
   * `status` was not read from the URL at all, which made the dashboard's most
   * useful action item - "Orders awaiting your approval", linking to
   * `/admin/orders?status=PENDING` - open the unfiltered queue instead.
   */
  const statusParam = searchParams.get("status") ?? "";
  const statusFilter = STATUS_OPTIONS.some((option) => option.value === statusParam)
    ? (statusParam as OrderStatus)
    : "";
  const batchFilter = searchParams.get("batchId") ?? "";
  const paymentFilter = searchParams.get("paymentStatus") ?? "";
  const customerTypeFilter = searchParams.get("customerType") ?? "";

  const [search, setSearch] = useState("");

  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const flash = (message: string) => {
    setNotice(message);
    setActionError("");
    setTimeout(() => setNotice(""), 4000);
  };

  const handleUpdateStatus = async (orderId: string, reference: string, newStatus: OrderStatus) => {
    setActionLoading(orderId);
    setActionError("");

    const previousOrders = orders;
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)));
    flash(`Order ${reference} marked as ${newStatus}.`);

    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const { ok, error } = await parseApiResponse(res, "Failed to update order");
      if (!ok) throw new Error(error || "Failed to update order");
    } catch (err) {
      setOrders(previousOrders);
      setNotice("");
      setActionError(err instanceof Error ? err.message : "Failed to update order");
    } finally {
      setActionLoading(null);
    }
  };

  const handleTogglePaid = async (orderId: string, reference: string, currentlyPaid: boolean) => {
    const nextPaid = !currentlyPaid;
    setActionLoading(orderId);
    setActionError("");

    const previousOrders = orders;
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId ? { ...o, paymentStatus: nextPaid ? "PAID" : "UNPAID" } : o
      )
    );
    flash(`Order ${reference} marked as ${nextPaid ? "PAID" : "UNPAID"}.`);

    try {
      const res = await fetch(`/api/admin/orders/${orderId}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paid: nextPaid }),
      });
      const { ok, error } = await parseApiResponse(res, "Failed to update payment");
      if (!ok) throw new Error(error || "Failed to update payment");
    } catch (err) {
      setOrders(previousOrders);
      setNotice("");
      setActionError(err instanceof Error ? err.message : "Failed to update payment");
    } finally {
      setActionLoading(null);
    }
  };

  /** Puts one filter in the URL, where the other four already live. */
  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const query = params.toString();
    setPage(1);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const clearFilters = () => {
    setSearch("");
    setPage(1);
    router.replace(pathname, { scroll: false });
  };

  const filterDescriptions: string[] = [];
  if (statusFilter) {
    const option = STATUS_OPTIONS.find((entry) => entry.value === statusFilter);
    filterDescriptions.push(option ? option.label : statusFilter);
  }
  if (batchFilter) {
    filterDescriptions.push("in one batch");
  }
  if (paymentFilter) filterDescriptions.push(paymentFilter === "UNPAID" ? "unpaid" : "paid");
  if (customerTypeFilter === "new") filterDescriptions.push("first-time customers");

  const hasFilters = filterDescriptions.length > 0 || Boolean(search);

  const exportHref = (() => {
    const params = new URLSearchParams();
    if (batchFilter) params.set("batchId", batchFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (paymentFilter) params.set("paymentStatus", paymentFilter);
    if (customerTypeFilter) params.set("customerType", customerTypeFilter);
    const query = params.toString();
    return `/api/admin/orders/export${query ? `?${query}` : ""}`;
  })();

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
        const { ok, data } = await parseApiResponse(res);
        if (ok && data) {
          setOrders(data.orders);
          setTotalPages(data.pagination.totalPages);
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
      AWAITING_PAYMENT: "badge-pending",
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
          Export CSV
        </a>
      </div>

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

      {hasFilters && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-600)", marginBottom: "var(--space-3)" }}>
          {filterDescriptions.length > 0
            ? `Showing ${filterDescriptions.join(" \u00b7 ")}.`
            : "Showing your search results."}{" "}
          <button type="button" onClick={clearFilters} className="btn btn-ghost btn-sm">Clear filters</button>
        </p>
      )}

      <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: "var(--space-6)", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search by customer name, Instagram handle, or reference..."
          className="form-input"
          style={{ flex: "1 1 240px", maxWidth: "420px" }}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select
          className="form-input"
          style={{ flex: "0 1 180px", minWidth: "140px" }}
          value={statusFilter}
          onChange={(e) => setFilter("status", e.target.value)}
          aria-label="Filter by order status"
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className="table-wrapper">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Reference</th>
                <th>Batch / Drop</th>
                <th>Items</th>
                <th>Total</th>
                <th>Payment</th>
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
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                        <Link
                          href={`/admin/orders/${order.id}`}
                          style={{
                            fontSize: "var(--text-lg)",
                            fontWeight: 700,
                            color: "var(--color-neutral-900)",
                            textDecoration: "none",
                            lineHeight: 1.3,
                          }}
                        >
                          {snapshot.fullName || "—"}
                        </Link>
                      </div>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", marginTop: "2px" }}>
                        {handle ? `@${handle}` : "no Instagram handle"}
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--text-xs)",
                          color: "var(--color-neutral-600)",
                          background: "var(--color-neutral-100)",
                          padding: "2px 7px",
                          borderRadius: "var(--radius-sm)",
                          fontWeight: 500,
                          letterSpacing: "0.02em",
                        }}
                      >
                        {order.reference}
                      </span>
                      {order.isPossibleDuplicate && <span style={{ color: "var(--color-warning)", fontSize: "11px", marginLeft: "4px" }} title="Possible duplicate">Duplicate</span>}
                    </td>
                    <td>
                      {/* No "unassigned" branch: `Order.batchId` is required, so every
                          order in this list belongs to a batch. The warning badge
                          that used to live here described a state the database does
                          not allow. */}
                      <span style={{ fontWeight: 500 }}>{order.batch.name}</span>
                    </td>
                    <td>{itemCount} item{itemCount !== 1 ? 's' : ''}</td>
                    <td style={{ fontWeight: 600 }}>₱{Number(order.total).toLocaleString()}</td>
                    <td>
                      {order.status === "PENDING" ? (
                        <span className="badge" style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d", fontWeight: 700 }}>
                          Waiting
                        </span>
                      ) : (
                        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={isPaid}
                            disabled={actionLoading === order.id || ["CANCELLED", "REJECTED"].includes(order.status)}
                            onChange={() => handleTogglePaid(order.id, order.reference, isPaid)}
                            style={{ accentColor: "var(--color-brand-600)", width: "16px", height: "16px" }}
                          />
                          <span
                            className="badge"
                            style={{
                              background: isPaid ? "#dcfce7" : "#fee2e2",
                              color: isPaid ? "#14532d" : "#991b1b",
                              border: isPaid ? "1px solid #86efac" : "1px solid #fca5a5",
                              fontWeight: 700,
                              fontSize: "12px",
                              padding: "2px 8px",
                            }}
                          >
                            {isPaid ? "PAID" : "UNPAID"}
                          </span>
                        </label>
                      )}
                    </td>
                    <td style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                      {format(new Date(order.createdAt), "MMM d, yyyy h:mm a")}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", justifyContent: "flex-end" }}>
                        {order.status === "PENDING" && (
                          <>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              style={{ whiteSpace: "nowrap" }}
                              disabled={actionLoading === order.id}
                              onClick={() => handleUpdateStatus(order.id, order.reference, "CONFIRMED")}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ color: "var(--color-error)" }}
                              disabled={actionLoading === order.id}
                              onClick={() => {
                                if (window.confirm("Cancel this order? Stock will be returned.")) {
                                  handleUpdateStatus(order.id, order.reference, "CANCELLED");
                                }
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        <Link href={`/admin/orders/${order.id}`} className="btn btn-ghost btn-sm">
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

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
