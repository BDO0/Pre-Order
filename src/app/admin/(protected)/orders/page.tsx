"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  { value: "PENDING", label: "Pending" },
  { value: "AWAITING_PAYMENT", label: "Awaiting Payment" },
  { value: "PAYMENT_REVIEW", label: "Payment Review" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "PROCESSING", label: "Processing" },
  { value: "READY", label: "Ready for Pickup" },
  { value: "SHIPPED", label: "Shipped" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REJECTED", label: "Rejected" },
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

  // The one filter that is not in the URL: a search box that wrote to the address
  // bar on every keystroke would leave a history entry per letter.
  const [search, setSearch] = useState("");

  /** Puts one filter in the URL, where the other four already live. */
  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const query = params.toString();
    // Page 1, because the old page number belonged to a longer list: filtering a
    // queue down and still being on page 3 shows an empty table.
    setPage(1);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const clearFilters = () => {
    setSearch("");
    setPage(1);
    router.replace(pathname, { scroll: false });
  };

  // What the banner says the table is showing. The status filter was missing from
  // it, so a queue narrowed to Pending still read as unfiltered.
  const filterDescriptions: string[] = [];
  if (statusFilter) {
    const option = STATUS_OPTIONS.find((entry) => entry.value === statusFilter);
    filterDescriptions.push(option ? option.label : statusFilter);
  }
  if (batchFilter) {
    // Always "in one batch": an order with no batch is not a state the database
    // allows (`Order.batchId` is required), so there is no other phrasing to pick.
    filterDescriptions.push("in one batch");
  }
  if (paymentFilter) filterDescriptions.push(paymentFilter === "UNPAID" ? "unpaid" : "paid");
  if (customerTypeFilter === "new") filterDescriptions.push("first-time customers");

  // The search box counts too, or a search could not be cleared once the address
  // bar had been emptied of everything else.
  const hasFilters = filterDescriptions.length > 0 || Boolean(search);

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
          ⬇ Export CSV
        </a>
      </div>

      {hasFilters && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-600)", marginBottom: "var(--space-3)" }}>
          {filterDescriptions.length > 0
            ? `Showing ${filterDescriptions.join(" \u00b7 ")}.`
            : "Showing your search results."}{" "}
          <button type="button" onClick={clearFilters} className="btn btn-ghost btn-sm">Clear filters</button>
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
                      {/* No "unassigned" branch: `Order.batchId` is required, so every
                          order in this list belongs to a batch. The warning badge
                          that used to live here described a state the database does
                          not allow. */}
                      <span style={{ fontWeight: 500 }}>{order.batch.name}</span>
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
