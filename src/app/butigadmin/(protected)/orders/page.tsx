"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import type { OrderStatus, PaymentStatus } from "@prisma/client";
import { parseApiResponse } from "@/lib/api-client";

interface AdminOrderRow {
  id: string;
  reference: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  total: string | number;
  createdAt: string;
  isNewCustomer: boolean;
  isPossibleDuplicate: boolean;
  customerSnapshot: unknown;
  batch: { id: string; name: string; slug: string; status: string };
  items: { quantity: number; productNameSnapshot: string; unitPriceAtPurchase: string | number }[];
}

interface BatchOption {
  id: string;
  name: string;
  status: string;
}

type TabKey = "new" | "approved" | "approved-unpaid" | "cancelled";

const TABS: { key: TabKey; label: string; statusFilter: OrderStatus | ""; paymentFilter: string }[] = [
  { key: "new",            label: "New Orders",      statusFilter: "PENDING",   paymentFilter: "" },
  { key: "approved",       label: "Approved",         statusFilter: "CONFIRMED", paymentFilter: "PAID" },
  { key: "approved-unpaid",label: "Approved (Unpaid)",statusFilter: "CONFIRMED", paymentFilter: "UNPAID" },
  { key: "cancelled",      label: "Cancelled",        statusFilter: "CANCELLED", paymentFilter: "" },
];

export default function AdminOrdersPage() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const pathname     = usePathname();

  const activeTab   = (searchParams.get("tab") as TabKey) ?? "new";
  const batchFilter = searchParams.get("batchId") ?? "";
  const [search, setSearch]   = useState(searchParams.get("search") ?? "");
  const [page,   setPage]     = useState(1);

  const [orders,      setOrders]      = useState<AdminOrderRow[]>([]);
  const [totalPages,  setTotalPages]  = useState(1);
  const [totalCount,  setTotalCount]  = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [batches,     setBatches]     = useState<BatchOption[]>([]);

  const [notice,        setNotice]        = useState("");
  const [actionError,   setActionError]   = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [clearLoading,  setClearLoading]  = useState(false);

  const flash = (msg: string) => {
    setNotice(msg);
    setActionError("");
    setTimeout(() => setNotice(""), 4000);
  };

  const currentTab = TABS.find((t) => t.key === activeTab) ?? TABS[0];

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    setPage(1);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const switchTab = (tab: TabKey) => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (batchFilter) params.set("batchId", batchFilter);
    setPage(1);
    setSearch("");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const exportHref = (() => {
    const params = new URLSearchParams();
    if (batchFilter) params.set("batchId", batchFilter);
    params.set("status", "CONFIRMED");
    if (currentTab.key === "approved")        params.set("paymentStatus", "PAID");
    if (currentTab.key === "approved-unpaid") params.set("paymentStatus", "UNPAID");
    return `/api/admin/orders/export?${params.toString()}`;
  })();

  useEffect(() => {
    fetch("/api/admin/batches")
      .then((r) => r.json())
      .then((json) => {
        if (json?.success && Array.isArray(json.data)) {
          setBatches(
            (json.data as BatchOption[]).map((b) => ({
              id:     b.id,
              name:   b.name,
              status: b.status,
            }))
          );
        }
      })
      .catch(() => {  });
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page:  page.toString(),
        limit: "20",
        status: currentTab.statusFilter || "",
      });
      if (currentTab.paymentFilter) params.set("paymentStatus", currentTab.paymentFilter);
      if (currentTab.key === "cancelled") {
        params.set("status", "CANCELLED");
      }
      if (batchFilter) params.set("batchId", batchFilter);
      if (search)      params.set("search",  search);

      const res = await fetch(`/api/admin/orders?${params}`);
      const { ok, data } = await parseApiResponse(res);
      if (ok && data) {
        setOrders(data.orders);
        setTotalPages(data.pagination.totalPages);
        setTotalCount(data.pagination.total);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, search, currentTab, batchFilter]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const handleUpdateStatus = async (
    orderId: string,
    reference: string,
    newStatus: OrderStatus
  ) => {
    setActionLoading(orderId);
    setActionError("");
    const prev = orders;
    setOrders((o) => o.map((r) => (r.id === orderId ? { ...r, status: newStatus } : r)));
    flash(`Order ${reference} marked as ${newStatus}.`);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status: newStatus }),
      });
      const { ok, error } = await parseApiResponse(res, "Failed to update order");
      if (!ok) throw new Error(error || "Failed to update order");
    } catch (err) {
      setOrders(prev);
      setNotice("");
      setActionError(err instanceof Error ? err.message : "Failed to update order");
    } finally {
      setActionLoading(null);
    }
  };

  const handleTogglePaid = async (
    orderId: string,
    reference: string,
    currentlyPaid: boolean
  ) => {
    const nextPaid = !currentlyPaid;
    setActionLoading(orderId);
    setActionError("");
    const prev = orders;
    setOrders((o) =>
      o.map((r) =>
        r.id === orderId ? { ...r, paymentStatus: nextPaid ? "PAID" : "UNPAID" } : r
      )
    );
    flash(`Order ${reference} marked as ${nextPaid ? "PAID" : "UNPAID"}.`);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/payment`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ paid: nextPaid }),
      });
      const { ok, error } = await parseApiResponse(res, "Failed to update payment");
      if (!ok) throw new Error(error || "Failed to update payment");
    } catch (err) {
      setOrders(prev);
      setNotice("");
      setActionError(err instanceof Error ? err.message : "Failed to update payment");
    } finally {
      setActionLoading(null);
    }
  };

  const handleClearCancelled = async () => {
    const scope = batchFilter ? "this batch" : "ALL batches";
    const confirmed = window.confirm(
      `Permanently delete ALL cancelled orders from ${scope}?\n\nThis cannot be undone.`
    );
    if (!confirmed) return;

    setClearLoading(true);
    setActionError("");
    try {
      const params = new URLSearchParams();
      if (batchFilter) params.set("batchId", batchFilter);
      const res = await fetch(
        `/api/admin/orders/cancelled?${params.toString()}`,
        { method: "DELETE" }
      );
      const { ok, data, error } = await parseApiResponse(res, "Failed to clear cancelled orders");
      if (!ok) throw new Error(error || "Failed to clear cancelled orders");
      flash(`Cleared ${(data as { deleted: number }).deleted} cancelled order(s).`);
      setOrders([]);
      setTotalCount(0);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to clear cancelled orders");
    } finally {
      setClearLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      PENDING:         "badge-pending",
      AWAITING_PAYMENT:"badge-pending",
      PAYMENT_REVIEW:  "badge-coming",
      CONFIRMED:       "badge-confirmed",
      PROCESSING:      "badge-confirmed",
      READY:           "badge-confirmed",
      SHIPPED:         "badge-confirmed",
      COMPLETED:       "badge-completed",
      CANCELLED:       "badge-cancelled",
      REJECTED:        "badge-cancelled",
    };
    return `badge ${map[status] || "badge-closed"}`;
  };

  return (
    <div>
      {}
      <div
        className="admin-page-title"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}
      >
        <span>Orders</span>
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          {(currentTab.key === "approved" || currentTab.key === "approved-unpaid") && (
            <a href={exportHref} className="btn btn-secondary btn-sm">
              Export CSV{batchFilter ? " (this batch)" : " (all batches)"}
            </a>
          )}
        </div>
      </div>

      {}
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

      {}
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", marginBottom: "var(--space-4)", flexWrap: "wrap" }}>
        <label style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-neutral-700)", whiteSpace: "nowrap" }}>
          Batch / Drop:
        </label>
        <select
          className="form-input"
          style={{ flex: "0 1 280px", minWidth: "160px" }}
          value={batchFilter}
          onChange={(e) => setParam("batchId", e.target.value)}
          aria-label="Filter by batch"
        >
          <option value="">All Batches</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.status === "OPEN" ? " 🟢" : b.status === "CLOSED" ? " 🔒" : ""}
            </option>
          ))}
        </select>
        {batchFilter && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setParam("batchId", "")}
          >
            Clear batch filter
          </button>
        )}
      </div>

      {}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "2px solid var(--color-neutral-200)",
          marginBottom: "var(--space-5)",
          overflowX: "auto",
        }}
      >
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => switchTab(tab.key)}
              style={{
                padding: "var(--space-3) var(--space-5)",
                fontWeight: isActive ? 700 : 500,
                fontSize: "var(--text-sm)",
                color: isActive ? "var(--color-brand-700)" : "var(--color-neutral-600)",
                background: "none",
                border: "none",
                borderBottom: isActive
                  ? "2px solid var(--color-brand-600)"
                  : "2px solid transparent",
                marginBottom: "-2px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 150ms ease",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {}
      <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: "var(--space-5)", flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Search by name, Instagram handle, or reference..."
          className="form-input"
          style={{ flex: "1 1 240px", maxWidth: "420px" }}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        {activeTab === "cancelled" && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={clearLoading || totalCount === 0}
            onClick={handleClearCancelled}
            style={{
              background: "rgb(220 38 38 / 0.1)",
              border: "1px solid rgb(220 38 38 / 0.35)",
              color: "var(--color-error)",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {clearLoading ? "Clearing..." : `Clear All Cancelled${batchFilter ? " (this batch)" : ""}`}
          </button>
        )}
      </div>

      {}
      {!loading && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", marginBottom: "var(--space-3)" }}>
          {totalCount === 0
            ? "No orders found."
            : `${totalCount} order${totalCount !== 1 ? "s" : ""} found${batchFilter ? " in this batch" : ""}.`}
        </p>
      )}

      {}
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
                  <td colSpan={8} style={{ textAlign: "center", padding: "var(--space-8)" }}>Loading...</td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-neutral-500)" }}>
                    {activeTab === "cancelled"
                      ? "No cancelled orders — all clear! ✓"
                      : "No orders found."}
                  </td>
                </tr>
              ) : (
                orders.map((order) => {
                  const snapshot  = order.customerSnapshot as { fullName?: string; instagramHandle?: unknown };
                  const itemCount = order.items.reduce((s, i) => s + i.quantity, 0);
                  const isPaid    = order.paymentStatus === "PAID";
                  const handle    = typeof snapshot?.instagramHandle === "string" ? snapshot.instagramHandle : null;

                  return (
                    <tr key={order.id}>
                      {}
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                          <Link
                            href={`/butigadmin/orders/${order.id}`}
                            style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-neutral-900)", textDecoration: "none", lineHeight: 1.3 }}
                          >
                            {snapshot.fullName || "—"}
                          </Link>
                          {order.isNewCustomer && (
                            <span className="badge" style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", fontSize: "10px" }}>New</span>
                          )}
                        </div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", marginTop: "2px" }}>
                          {handle ? `@${handle}` : "no handle"}
                        </div>
                      </td>

                      {}
                      <td>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-neutral-600)", background: "var(--color-neutral-100)", padding: "2px 7px", borderRadius: "var(--radius-sm)", fontWeight: 500 }}>
                          {order.reference}
                        </span>
                        {order.isPossibleDuplicate && (
                          <span style={{ color: "var(--color-warning)", fontSize: "11px", marginLeft: "4px" }} title="Possible duplicate">Duplicate</span>
                        )}
                      </td>

                      {}
                      <td>
                        <span style={{ fontWeight: 500 }}>{order.batch.name}</span>
                      </td>

                      {}
                      <td>{itemCount} item{itemCount !== 1 ? "s" : ""}</td>

                      {}
                      <td style={{ fontWeight: 600 }}>₱{Number(order.total).toLocaleString()}</td>

                      {}
                      <td>
                        {order.status === "PENDING" ? (
                          <span className="badge" style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d", fontWeight: 700 }}>
                            Waiting
                          </span>
                        ) : ["CANCELLED", "REJECTED"].includes(order.status) ? (
                          <span className="badge badge-cancelled">—</span>
                        ) : (
                          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={isPaid}
                              disabled={actionLoading === order.id}
                              onChange={() => handleTogglePaid(order.id, order.reference, isPaid)}
                              style={{ accentColor: "var(--color-brand-600)", width: "16px", height: "16px" }}
                            />
                            <span
                              className="badge"
                              style={{
                                background: isPaid ? "#dcfce7" : "#fee2e2",
                                color:      isPaid ? "#14532d" : "#991b1b",
                                border:     isPaid ? "1px solid #86efac" : "1px solid #fca5a5",
                                fontWeight: 700,
                                fontSize:   "12px",
                                padding:    "2px 8px",
                              }}
                            >
                              {isPaid ? "PAID" : "UNPAID"}
                            </span>
                          </label>
                        )}
                      </td>

                      {}
                      <td style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                        {format(new Date(order.createdAt), "MMM d, yyyy h:mm a")}
                      </td>

                      {}
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
                          <Link href={`/butigadmin/orders/${order.id}`} className="btn btn-ghost btn-sm">
                            View
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: "var(--space-2)", marginTop: "var(--space-6)" }}>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span style={{ display: "flex", alignItems: "center", fontSize: "var(--text-sm)", color: "var(--color-neutral-600)" }}>
            Page {page} of {totalPages}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
