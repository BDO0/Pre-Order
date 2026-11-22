"use client";
import { formatMoney } from "@/lib/format";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import type { OrderStatus, PaymentStatus } from "@prisma/client";
import { parseApiResponse } from "@/lib/api-client";
import { getOrderStatusMeta } from "@/lib/order-status-meta";
import { isRedacted } from "@/lib/redaction";
import { formatInstagramHandle, instagramProfileUrl } from "@/lib/instagram";
import { copyTextToClipboard } from "@/lib/clipboard";
import adminStyles from "../admin.module.css";

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
  items: {
    quantity: number;
    productNameSnapshot: string;
    variantSnapshot?: { color?: string | null; size?: string | null } | null;
    unitPriceAtPurchase: string | number;
  }[];
}

interface BatchOption {
  id: string;
  name: string;
  status: string;
}

interface TabCounts {
  all: number;
  new: number;
  awaitingPayment: number;
  approvedPaid: number;
  fulfillment: number;
  shipped: number;
  completed: number;
  cancelled: number;
}

type TabKey =
  | "new"
  | "awaiting-payment"
  | "approved"
  | "fulfillment"
  | "shipped"
  | "completed"
  | "cancelled"
  | "all";

const TABS: {
  key: TabKey;
  label: string;
  statusFilter: string;
  paymentFilter: string;
  countKey: keyof TabCounts;
}[] = [
  {
    key: "new",
    label: "New Orders",
    statusFilter: "PENDING",
    paymentFilter: "",
    countKey: "new",
  },
  {
    key: "awaiting-payment",
    label: "Awaiting Payment",
    statusFilter: "AWAITING_PAYMENT,PAYMENT_REVIEW,CONFIRMED",
    paymentFilter: "UNPAID",
    countKey: "awaitingPayment",
  },
  {
    key: "approved",
    label: "Confirmed (Paid)",
    statusFilter: "CONFIRMED",
    paymentFilter: "PAID",
    countKey: "approvedPaid",
  },
  {
    key: "fulfillment",
    label: "In Fulfillment",
    statusFilter: "PROCESSING,READY",
    paymentFilter: "",
    countKey: "fulfillment",
  },
  {
    key: "shipped",
    label: "Shipped",
    statusFilter: "SHIPPED",
    paymentFilter: "",
    countKey: "shipped",
  },
  {
    key: "completed",
    label: "Completed",
    statusFilter: "COMPLETED",
    paymentFilter: "",
    countKey: "completed",
  },
  {
    key: "cancelled",
    label: "Cancelled",
    statusFilter: "CANCELLED,REJECTED",
    paymentFilter: "",
    countKey: "cancelled",
  },
  {
    key: "all",
    label: "All Orders",
    statusFilter: "",
    paymentFilter: "",
    countKey: "all",
  },
];

function rowMatchesTab(
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  tab: (typeof TABS)[number]
): boolean {
  if (tab.statusFilter) {
    const allowed = tab.statusFilter.split(",");
    if (!allowed.includes(status)) return false;
  }
  if (tab.paymentFilter && paymentStatus !== tab.paymentFilter) {
    return false;
  }
  return true;
}

function nextLifecycleStep(status: OrderStatus): { label: string; next: OrderStatus } | null {
  switch (status) {
    case "CONFIRMED":
      return { label: "Start Production", next: "PROCESSING" };
    case "PROCESSING":
      return { label: "Mark Ready", next: "READY" };
    case "READY":
      return { label: "Mark Shipped", next: "SHIPPED" };
    case "SHIPPED":
      return { label: "Mark Completed", next: "COMPLETED" };
    default:
      return null;
  }
}

export default function AdminOrdersPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawTab = searchParams.get("tab") as TabKey | null;
  const activeTab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : "new";
  const batchFilter = searchParams.get("batchId") ?? "";
  const [searchInput, setSearchInput] = useState(searchParams.get("search") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get("search") ?? "");
  const [page, setPage] = useState(1);

  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [counts, setCounts] = useState<TabCounts | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [batches, setBatches] = useState<BatchOption[]>([]);

  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [clearLoading, setClearLoading] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminOrderRow | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshOrders = () => setRefreshTick((t) => t + 1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 260);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenuId]);

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
    setSearchInput("");
    setDebouncedSearch("");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const exportHref = (() => {
    const params = new URLSearchParams();
    if (batchFilter) params.set("batchId", batchFilter);
    if (currentTab.statusFilter) params.set("status", currentTab.statusFilter);
    if (currentTab.paymentFilter) params.set("paymentStatus", currentTab.paymentFilter);
    return `/api/admin/orders/export?${params.toString()}`;
  })();

  useEffect(() => {
    fetch("/api/admin/batches")
      .then((r) => r.json())
      .then((json) => {
        if (json?.success && Array.isArray(json.data)) {
          setBatches(
            (json.data as BatchOption[]).map((b) => ({
              id: b.id,
              name: b.name,
              status: b.status,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  const tabStatusFilter = currentTab.statusFilter;
  const tabPaymentFilter = currentTab.paymentFilter;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: "20",
        });
        if (tabStatusFilter) params.set("status", tabStatusFilter);
        if (tabPaymentFilter) params.set("paymentStatus", tabPaymentFilter);
        if (batchFilter) params.set("batchId", batchFilter);
        if (debouncedSearch) params.set("search", debouncedSearch);

        const res = await fetch(`/api/admin/orders?${params}`, {
          signal: controller.signal,
        });
        const { ok, data } = await parseApiResponse(res);
        if (active && ok && data) {
          setOrders(data.orders);
          if (data.counts) setCounts(data.counts);
          setTotalPages(Math.max(1, data.pagination.totalPages));
          setTotalCount(data.pagination.total);
        }
      } catch (e) {
        if ((e as { name?: string })?.name !== "AbortError") {
          console.error(e);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [page, debouncedSearch, tabStatusFilter, tabPaymentFilter, batchFilter, refreshTick]);

  const handleUpdateStatus = async (
    orderId: string,
    reference: string,
    newStatus: OrderStatus
  ) => {
    setActionLoading(orderId);
    setActionError("");
    const prev = orders;
    const targetRow = orders.find((r) => r.id === orderId);
    const keepInTab = targetRow
      ? rowMatchesTab(newStatus, targetRow.paymentStatus, currentTab)
      : true;

    setOrders((o) =>
      keepInTab
        ? o.map((r) => (r.id === orderId ? { ...r, status: newStatus } : r))
        : o.filter((r) => r.id !== orderId)
    );
    flash(`Order ${reference} marked as ${getOrderStatusMeta(newStatus).label}.`);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const { ok, error } = await parseApiResponse(res, "Failed to update order");
      if (!ok) throw new Error(error || "Failed to update order");
      refreshOrders();
    } catch (err) {
      setOrders(prev);
      setNotice("");
      setActionError(err instanceof Error ? err.message : "Failed to update order");
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirmAndPay = async (orderId: string, reference: string) => {
    setActionLoading(orderId);
    setActionError("");
    const prev = orders;
    const keepInTab = rowMatchesTab("CONFIRMED", "PAID", currentTab);
    setOrders((o) =>
      keepInTab
        ? o.map((r) =>
            r.id === orderId ? { ...r, status: "CONFIRMED", paymentStatus: "PAID" } : r
          )
        : o.filter((r) => r.id !== orderId)
    );
    flash(`Order ${reference} approved & marked as PAID.`);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/confirm-and-pay`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Approved & payment recorded" }),
      });
      const { ok, error } = await parseApiResponse(res, "Failed to approve & mark paid");
      if (!ok) throw new Error(error || "Failed to approve & mark paid");
      refreshOrders();
    } catch (err) {
      setOrders(prev);
      setNotice("");
      setActionError(err instanceof Error ? err.message : "Failed to approve & mark paid");
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
    const nextPaymentStatus: PaymentStatus = nextPaid ? "PAID" : "UNPAID";
    setActionLoading(orderId);
    setActionError("");
    const prev = orders;
    const targetRow = orders.find((r) => r.id === orderId);
    const keepInTab = targetRow
      ? rowMatchesTab(targetRow.status, nextPaymentStatus, currentTab)
      : true;

    setOrders((o) =>
      keepInTab
        ? o.map((r) => (r.id === orderId ? { ...r, paymentStatus: nextPaymentStatus } : r))
        : o.filter((r) => r.id !== orderId)
    );
    flash(`Order ${reference} marked as ${nextPaymentStatus}.`);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paid: nextPaid }),
      });
      const { ok, error } = await parseApiResponse(res, "Failed to update payment");
      if (!ok) throw new Error(error || "Failed to update payment");
      refreshOrders();
    } catch (err) {
      setOrders(prev);
      setNotice("");
      setActionError(err instanceof Error ? err.message : "Failed to update payment");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCopyDmMessage = async (order: AdminOrderRow) => {
    const snapshot = order.customerSnapshot as { fullName?: string; instagramHandle?: string };
    const name = snapshot.fullName || "there";
    const itemsList = order.items
      .map((i) => {
        const v = [i.variantSnapshot?.color, i.variantSnapshot?.size].filter(Boolean).join(" / ");
        return `• ${i.quantity}x ${i.productNameSnapshot}${v ? ` (${v})` : ""}`;
      })
      .join("\n");
    const msg =
      `Hi ${name}! Thank you for your pre-order (${order.reference}).\n\n` +
      `${itemsList}\n` +
      `Total: ${formatMoney(Number(order.total))}\n\n` +
      `Please reply here to confirm your order and settle payment so we can lock in your slot!`;
    const ok = await copyTextToClipboard(msg);
    if (ok) flash(`Copied IG DM confirmation message for ${order.reference}.`);
    else setActionError("Could not copy DM message to clipboard.");
  };

  const confirmDeleteOrder = async () => {
    if (!deleteTarget) return;
    setActionLoading(deleteTarget.id);
    setActionError("");
    try {
      const res = await fetch(`/api/admin/orders/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const { ok, error } = await parseApiResponse(res, "Failed to delete order");
      if (!ok) throw new Error(error || "Failed to delete order");
      setOrders((prev) => prev.filter((o) => o.id !== deleteTarget.id));
      setTotalCount((c) => Math.max(0, c - 1));
      flash(`Order ${deleteTarget.reference} deleted permanently.`);
      setDeleteTarget(null);
      setDeleteConfirmText("");
      refreshOrders();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete order");
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
      const res = await fetch(`/api/admin/orders/cancelled?${params.toString()}`, {
        method: "DELETE",
      });
      const { ok, data, error } = await parseApiResponse(
        res,
        "Failed to clear cancelled orders"
      );
      if (!ok) throw new Error(error || "Failed to clear cancelled orders");
      flash(`Cleared ${(data as { deleted: number }).deleted} cancelled order(s).`);
      refreshOrders();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to clear cancelled orders"
      );
    } finally {
      setClearLoading(false);
    }
  };

  return (
    <div>
      <div
        className="admin-page-title"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-4)",
        }}
      >
        <span>Orders</span>
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          <a href={exportHref} className="btn btn-secondary btn-sm">
            Export CSV{batchFilter ? " (this batch)" : ""}
          </a>
        </div>
      </div>

      {notice && (
        <div
          style={{
            padding: "var(--space-3) var(--space-4)",
            background: "rgb(22 163 74 / 0.08)",
            border: "1px solid rgb(22 163 74 / 0.3)",
            borderRadius: "var(--radius-lg)",
            color: "var(--color-success)",
            fontWeight: 500,
            marginBottom: "var(--space-4)",
          }}
        >
          {notice}
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          style={{
            padding: "var(--space-3) var(--space-4)",
            background: "rgb(220 38 38 / 0.08)",
            border: "1px solid rgb(220 38 38 / 0.3)",
            borderRadius: "var(--radius-lg)",
            color: "var(--color-error)",
            fontWeight: 500,
            marginBottom: "var(--space-4)",
          }}
        >
          {actionError}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: "var(--space-3)",
          alignItems: "center",
          marginBottom: "var(--space-4)",
          flexWrap: "wrap",
        }}
      >
        <label
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            color: "var(--color-neutral-700)",
            whiteSpace: "nowrap",
          }}
        >
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
              {b.name} ({b.status})
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
          const tabCount = counts ? counts[tab.countKey] : null;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => switchTab(tab.key)}
              style={{
                padding: "var(--space-3) var(--space-4)",
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
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                transition: "all 150ms ease",
              }}
            >
              <span>{tab.label}</span>
              {tabCount !== null && (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: "var(--radius-full)",
                    background: isActive ? "var(--color-brand-100)" : "var(--color-neutral-100)",
                    color: isActive ? "var(--color-brand-700)" : "var(--color-neutral-600)",
                  }}
                >
                  {tabCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          gap: "var(--space-3)",
          marginBottom: "var(--space-5)",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          type="text"
          placeholder="Search by name, Instagram handle, or reference..."
          className="form-input"
          style={{ flex: "1 1 240px", maxWidth: "420px" }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
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
            {clearLoading
              ? "Clearing..."
              : `Clear All Cancelled${batchFilter ? " (this batch)" : ""}`}
          </button>
        )}
      </div>

      {!loading && (
        <p
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--color-neutral-500)",
            marginBottom: "var(--space-3)",
          }}
        >
          {totalCount === 0
            ? "No orders found."
            : `${totalCount} order${totalCount !== 1 ? "s" : ""} found${batchFilter ? " in this batch" : ""}.`}
        </p>
      )}

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
                <th>Status</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: "var(--space-8)" }}>
                    Loading...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      textAlign: "center",
                      padding: "var(--space-8)",
                      color: "var(--color-neutral-500)",
                    }}
                  >
                    {activeTab === "cancelled"
                      ? "No cancelled orders — all clear!"
                      : "No orders found."}
                  </td>
                </tr>
              ) : (
                orders.map((order) => {
                  const snapshot = order.customerSnapshot as {
                    fullName?: string;
                    instagramHandle?: unknown;
                  };
                  const itemCount = order.items.reduce((s, i) => s + i.quantity, 0);
                  const isPaid = order.paymentStatus === "PAID";
                  const rawHandle =
                    typeof snapshot?.instagramHandle === "string"
                      ? snapshot.instagramHandle
                      : null;
                  const handleRedacted = isRedacted(rawHandle);
                  const statusMeta = getOrderStatusMeta(order.status);
                  const nextStep = nextLifecycleStep(order.status);
                  const canDeleteRow =
                    order.status === "CANCELLED" || order.status === "REJECTED";
                  const isMenuOpen = openMenuId === order.id;

                  return (
                    <tr key={order.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                          <Link
                            href={`/butigadmin/orders/${order.id}`}
                            style={{
                              fontSize: "var(--text-base)",
                              fontWeight: 700,
                              color: "var(--color-neutral-900)",
                              textDecoration: "none",
                              lineHeight: 1.3,
                            }}
                          >
                            {snapshot.fullName || "—"}
                          </Link>
                          {order.isNewCustomer && (
                            <span className="badge badge-info" style={{ fontSize: "10px" }}>
                              New
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: "var(--text-xs)",
                            color: "var(--color-neutral-500)",
                            marginTop: "2px",
                          }}
                        >
                          {handleRedacted ? (
                            <span>{rawHandle}</span>
                          ) : rawHandle ? (
                            <a
                              href={instagramProfileUrl(rawHandle)}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: "var(--color-brand-600)", fontWeight: 600 }}
                            >
                              @{formatInstagramHandle(rawHandle)}
                            </a>
                          ) : (
                            <span>no handle</span>
                          )}
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
                          }}
                        >
                          {order.reference}
                        </span>
                        {order.isPossibleDuplicate && (
                          <span
                            style={{
                              color: "var(--color-warning)",
                              fontSize: "11px",
                              marginLeft: "4px",
                              fontWeight: 600,
                            }}
                            title="Possible duplicate"
                          >
                            Duplicate
                          </span>
                        )}
                      </td>

                      <td>
                        <span style={{ fontWeight: 500 }}>{order.batch.name}</span>
                      </td>

                      <td>
                        {itemCount} item{itemCount !== 1 ? "s" : ""}
                      </td>

                      <td style={{ fontWeight: 600 }}>
                        {formatMoney(Number(order.total))}
                      </td>

                      <td>
                        {order.status === "PENDING" ? (
                          <span className="badge badge-amber">Waiting</span>
                        ) : ["CANCELLED", "REJECTED"].includes(order.status) ? (
                          <span className="badge badge-neutral">—</span>
                        ) : (
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "var(--space-2)",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isPaid}
                              disabled={actionLoading === order.id}
                              onChange={() =>
                                handleTogglePaid(order.id, order.reference, isPaid)
                              }
                              style={{
                                accentColor: "var(--color-brand-600)",
                                width: "16px",
                                height: "16px",
                              }}
                            />
                            <span
                              className={`badge ${isPaid ? "badge-success" : "badge-danger"}`}
                            >
                              {isPaid ? "PAID" : "UNPAID"}
                            </span>
                          </label>
                        )}
                      </td>

                      <td>
                        <span className={`badge ${statusMeta.badgeClass}`}>
                          {statusMeta.label}
                        </span>
                      </td>

                      <td
                        style={{
                          fontSize: "var(--text-xs)",
                          color: "var(--color-neutral-500)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {format(new Date(order.createdAt), "MMM d, yyyy h:mm a")}
                      </td>

                      <td>
                        <div
                          style={{
                            display: "flex",
                            gap: "var(--space-2)",
                            alignItems: "center",
                            justifyContent: "flex-end",
                          }}
                        >
                          {order.status === "PENDING" && (
                            <>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                style={{ whiteSpace: "nowrap" }}
                                disabled={actionLoading === order.id}
                                onClick={() =>
                                  handleUpdateStatus(order.id, order.reference, "CONFIRMED")
                                }
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ whiteSpace: "nowrap", color: "var(--color-success)" }}
                                disabled={actionLoading === order.id}
                                onClick={() =>
                                  handleConfirmAndPay(order.id, order.reference)
                                }
                              >
                                Approve & Paid
                              </button>
                            </>
                          )}
                          {nextStep && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ whiteSpace: "nowrap" }}
                              disabled={actionLoading === order.id}
                              onClick={() =>
                                handleUpdateStatus(order.id, order.reference, nextStep.next)
                              }
                            >
                              {nextStep.label}
                            </button>
                          )}
                          <Link
                            href={`/butigadmin/orders/${order.id}`}
                            className="btn btn-ghost btn-sm"
                          >
                            View
                          </Link>

                          <div
                            className={adminStyles.overflowWrap}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-label="More order actions"
                              aria-expanded={isMenuOpen}
                              onClick={() =>
                                setOpenMenuId(isMenuOpen ? null : order.id)
                              }
                            >
                              ⋯
                            </button>
                            {isMenuOpen && (
                              <div className={adminStyles.overflowMenu} role="menu">
                                <button
                                  type="button"
                                  className={adminStyles.overflowItem}
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    void handleCopyDmMessage(order);
                                  }}
                                >
                                  Copy IG DM Message
                                </button>
                                {!["CANCELLED", "REJECTED", "COMPLETED", "SHIPPED"].includes(
                                  order.status
                                ) && (
                                  <button
                                    type="button"
                                    className={`${adminStyles.overflowItem} ${adminStyles.overflowItemDanger}`}
                                    disabled={actionLoading === order.id}
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      if (
                                        window.confirm(
                                          `Cancel order ${order.reference}? Reserved stock will be returned.`
                                        )
                                      ) {
                                        void handleUpdateStatus(
                                          order.id,
                                          order.reference,
                                          "CANCELLED"
                                        );
                                      }
                                    }}
                                  >
                                    Cancel Order
                                  </button>
                                )}
                                {canDeleteRow && (
                                  <button
                                    type="button"
                                    className={`${adminStyles.overflowItem} ${adminStyles.overflowItemDanger}`}
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      setDeleteConfirmText("");
                                      setDeleteTarget(order);
                                    }}
                                  >
                                    Delete Permanently
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
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

      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "var(--space-2)",
            marginTop: "var(--space-6)",
          }}
        >
          <button
            className="btn btn-secondary btn-sm"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: "var(--text-sm)",
              color: "var(--color-neutral-600)",
            }}
          >
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

      {deleteTarget && (
        <div
          className={adminStyles.modalBackdrop}
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className={adminStyles.modalCard}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-order-title"
          >
            <h3
              id="delete-order-title"
              style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-error)" }}
            >
              Permanently delete {deleteTarget.reference}?
            </h3>
            <p
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--color-neutral-600)",
                marginTop: "var(--space-2)",
              }}
            >
              This removes the order, its items, and its audit history forever. Type{" "}
              <strong>{deleteTarget.reference}</strong> to confirm.
            </p>
            <input
              type="text"
              className="form-input"
              style={{ marginTop: "var(--space-3)" }}
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={deleteTarget.reference}
              autoFocus
            />
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--space-2)",
                marginTop: "var(--space-4)",
              }}
            >
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={
                  deleteConfirmText.trim() !== deleteTarget.reference ||
                  actionLoading === deleteTarget.id
                }
                onClick={() => void confirmDeleteOrder()}
              >
                {actionLoading === deleteTarget.id ? "Deleting..." : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
