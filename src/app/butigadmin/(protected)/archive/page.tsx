"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { formatMoney } from "@/lib/format";
import { parseApiResponse } from "@/lib/api-client";
import { getOrderStatusMeta, getBatchStatusMeta } from "@/lib/order-status-meta";
import { isRedacted } from "@/lib/redaction";
import { formatInstagramHandle, instagramProfileUrl } from "@/lib/instagram";
import { imageUrlAtWidth } from "@/lib/image-geometry";
import type { OrderStatus, PaymentStatus } from "@prisma/client";

interface ArchiveAnalytics {
  archivedOrdersCount: number;
  archivedPaidOrdersCount: number;
  archivedBatchesCount: number;
  archivedProductsCount: number;
  archivedCollectedRevenue: number;
  archivedGrossValue: number;
  activeOrdersCount: number;
  activeCollectedRevenue: number;
  lifetimeCollectedRevenue: number;
}

interface ArchivedOrderRow {
  id: string;
  reference: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  total: string | number;
  createdAt: string;
  archivedAt: string | null;
  customerSnapshot: unknown;
  batch: { id: string; name: string; slug: string; status: string } | null;
  items: {
    quantity: number;
    productNameSnapshot: string;
    variantSnapshot?: { color?: string | null; size?: string | null } | null;
    unitPriceAtPurchase: string | number;
  }[];
}

interface ArchivedBatchRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  description: string | null;
  startAt: string | null;
  endAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  totalOrders: number;
  validOrderCount: number;
  cancelledOrderCount: number;
  paidRevenue: number;
  grossValue: number;
  productCount: number;
}

interface ArchivedProductRow {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  price: number;
  currency: string;
  images: string[];
  archivedAt: string | null;
  createdAt: string;
  variantCount: number;
  unitsOrdered: number;
  paidUnits: number;
  totalRevenue: number;
  paidRevenue: number;
}

interface ArchiveCapabilities {
  manageOrders: boolean;
  manageBatches: boolean;
  manageProducts: boolean;
  permanentDelete: boolean;
}

type ArchiveTab = "orders" | "batches" | "products";

export default function AdminArchivePage() {
  const [activeTab, setActiveTab] = useState<ArchiveTab>("orders");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [orderPage, setOrderPage] = useState(1);
  const [ordersPagination, setOrdersPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [analytics, setAnalytics] = useState<ArchiveAnalytics>({
    archivedOrdersCount: 0,
    archivedPaidOrdersCount: 0,
    archivedBatchesCount: 0,
    archivedProductsCount: 0,
    archivedCollectedRevenue: 0,
    archivedGrossValue: 0,
    activeOrdersCount: 0,
    activeCollectedRevenue: 0,
    lifetimeCollectedRevenue: 0,
  });
  const [orders, setOrders] = useState<ArchivedOrderRow[]>([]);
  const [batches, setBatches] = useState<ArchivedBatchRow[]>([]);
  const [products, setProducts] = useState<ArchivedProductRow[]>([]);
  const [capabilities, setCapabilities] = useState<ArchiveCapabilities>({
    manageOrders: false,
    manageBatches: false,
    manageProducts: false,
    permanentDelete: false,
  });

  const flash = (msg: string) => {
    setNotice(msg);
    setError("");
    setTimeout(() => setNotice(""), 4500);
  };

  const loadArchive = async (pageToLoad = orderPage, queryToLoad = debouncedSearch) => {
    try {
      const params = new URLSearchParams({
        page: String(pageToLoad),
        limit: "50",
      });
      if (queryToLoad) params.set("search", queryToLoad);
      const res = await fetch(`/api/admin/archive?${params.toString()}`);
      const { ok, data, error: apiErr } = await parseApiResponse<{
        analytics: ArchiveAnalytics;
        orders: ArchivedOrderRow[];
        ordersPagination?: { page: number; limit: number; total: number; totalPages: number };
        batches: ArchivedBatchRow[];
        products: ArchivedProductRow[];
        capabilities: ArchiveCapabilities;
      }>(res, "Failed to load archive");
      if (!ok || !data) {
        setError(apiErr || "Failed to load archive");
        return;
      }
      setAnalytics(data.analytics);
      setOrders(data.orders ?? []);
      if (data.ordersPagination) {
        setOrdersPagination(data.ordersPagination);
      }
      setBatches(data.batches ?? []);
      setProducts(data.products ?? []);
      setCapabilities(data.capabilities);
    } catch {
      setError("Failed to load archive");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOrderPage(1);
    }, 260);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    void loadArchive(orderPage, debouncedSearch);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [orderPage, debouncedSearch]);

  const handleAction = async (
    type: "order" | "batch" | "product",
    id: string,
    label: string,
    action: "restore" | "permanent_delete"
  ) => {
    if (action === "permanent_delete") {
      const prompt =
        type === "product"
          ? `Permanently delete product "${label}" from the database?\n\nHistorical order receipts and revenue numbers that included this product will still be preserved. This cannot be undone.`
          : type === "batch"
          ? `Permanently delete batch "${label}" and all its orders from the database?\n\nThis cannot be undone.`
          : `Permanently delete order ${label} from the database?\n\nThis cannot be undone.`;
      if (!window.confirm(prompt)) return;
    }

    setBusyId(id);
    setError("");
    try {
      const res = await fetch("/api/admin/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id, action }),
      });
      const { ok, data, error: apiErr } = await parseApiResponse<{ message?: string }>(
        res,
        "Action failed"
      );
      if (!ok) throw new Error(apiErr || "Action failed");
      flash(data?.message || (action === "restore" ? "Restored." : "Permanently deleted."));
      await loadArchive();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const query = search.trim().toLowerCase();

  const filteredOrders = useMemo(() => {
    if (!query) return orders;
    return orders.filter((o) => {
      const snap = (o.customerSnapshot ?? {}) as { fullName?: string; instagramHandle?: string };
      return (
        o.reference.toLowerCase().includes(query) ||
        (snap.fullName ?? "").toLowerCase().includes(query) ||
        (snap.instagramHandle ?? "").toLowerCase().includes(query) ||
        (o.batch?.name ?? "").toLowerCase().includes(query) ||
        o.items.some((i) => i.productNameSnapshot.toLowerCase().includes(query))
      );
    });
  }, [orders, query]);

  const filteredBatches = useMemo(() => {
    if (!query) return batches;
    return batches.filter(
      (b) =>
        b.name.toLowerCase().includes(query) ||
        (b.description ?? "").toLowerCase().includes(query)
    );
  }, [batches, query]);

  const filteredProducts = useMemo(() => {
    if (!query) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        (p.category ?? "").toLowerCase().includes(query)
    );
  }, [products, query]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "var(--space-3)",
          marginBottom: "var(--space-5)",
        }}
      >
        <div>
          <h1 className="admin-page-title" style={{ marginBottom: "4px" }}>
            Archive &amp; Historical Analytics
          </h1>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", margin: 0 }}>
            Deleted orders, batches, and products live here so your active tabs stay clean while preserving every peso of historical revenue and activity.
          </p>
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

      {error && (
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
          {error}
        </div>
      )}

      {/* Analytics Summary Cards */}
      <div className="stats-grid" style={{ marginBottom: "var(--space-6)" }}>
        <div className="stat-card">
          <p className="stat-label">Lifetime Paid Revenue (Active + Archive)</p>
          <p className="stat-value" style={{ fontSize: "var(--text-xl)", color: "var(--color-brand-700, #881337)" }}>
            {formatMoney(analytics.lifetimeCollectedRevenue)}
          </p>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", marginTop: "4px" }}>
            Active: {formatMoney(analytics.activeCollectedRevenue)} · Archived:{" "}
            {formatMoney(analytics.archivedCollectedRevenue)}
          </p>
        </div>

        <div className="stat-card">
          <p className="stat-label">Archived Paid Revenue</p>
          <p className="stat-value" style={{ fontSize: "var(--text-xl)" }}>
            {formatMoney(analytics.archivedCollectedRevenue)}
          </p>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", marginTop: "4px" }}>
            From {analytics.archivedPaidOrdersCount} paid archived order
            {analytics.archivedPaidOrdersCount === 1 ? "" : "s"}
          </p>
        </div>

        <div className="stat-card">
          <p className="stat-label">Archived Orders</p>
          <p className="stat-value">{analytics.archivedOrdersCount}</p>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", marginTop: "4px" }}>
            Non-cancelled order value: {formatMoney(analytics.archivedGrossValue)}
          </p>
        </div>

        <div className="stat-card">
          <p className="stat-label">Archived Batches &amp; Products</p>
          <p className="stat-value">
            {analytics.archivedBatchesCount} / {analytics.archivedProductsCount}
          </p>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", marginTop: "4px" }}>
            {analytics.archivedBatchesCount} batch{analytics.archivedBatchesCount === 1 ? "" : "es"} ·{" "}
            {analytics.archivedProductsCount} product{analytics.archivedProductsCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {/* Sub-Tabs and Search */}
      <div
        className="card"
        style={{ marginBottom: "var(--space-4)", padding: "var(--space-3) var(--space-4)" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "var(--space-3)",
          }}
        >
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === "orders" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveTab("orders")}
            >
              Orders ({analytics.archivedOrdersCount})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === "batches" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveTab("batches")}
            >
              Batches ({batches.length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === "products" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveTab("products")}
            >
              Products ({products.length})
            </button>
          </div>
          <div style={{ minWidth: "240px", flex: "0 1 320px" }}>
            <input
              type="search"
              className="form-input"
              placeholder={`Search archived ${activeTab}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-neutral-500)" }}>
            Loading archive...
          </div>
        </div>
      ) : activeTab === "orders" ? (
        <div className="table-wrapper">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Customer</th>
                  <th>Batch</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Archived</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-neutral-400)" }}>
                      No archived orders found.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((order) => {
                    const snap = (order.customerSnapshot ?? {}) as {
                      fullName?: string;
                      instagramHandle?: string;
                    };
                    const statusMeta = getOrderStatusMeta(order.status);
                    const ig = snap.instagramHandle;
                    const redacted = isRedacted(ig);
                    return (
                      <tr key={order.id}>
                        <td>
                          <Link
                            href={`/butigadmin/orders/${order.id}`}
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: "var(--text-xs)",
                              fontWeight: 700,
                              color: "var(--color-brand-700, #881337)",
                              textDecoration: "none",
                            }}
                          >
                            {order.reference}
                          </Link>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: "var(--color-neutral-900)" }}>
                            {snap.fullName || "—"}
                          </div>
                          {ig && !redacted && (
                            <a
                              href={instagramProfileUrl(ig)}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontSize: "var(--text-xs)", color: "var(--color-brand-600)", textDecoration: "none" }}
                            >
                              @{formatInstagramHandle(ig)}
                            </a>
                          )}
                        </td>
                        <td style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-600)" }}>
                          {order.batch?.name ?? "—"}
                        </td>
                        <td style={{ fontSize: "var(--text-xs)", maxWidth: "260px" }}>
                          {order.items.map((item, idx) => {
                            const v = [item.variantSnapshot?.color, item.variantSnapshot?.size]
                              .filter(Boolean)
                              .join(" / ");
                            return (
                              <div key={idx}>
                                {item.quantity}× {item.productNameSnapshot}
                                {v ? ` (${v})` : ""}
                              </div>
                            );
                          })}
                        </td>
                        <td style={{ fontWeight: 700 }}>{formatMoney(Number(order.total))}</td>
                        <td>
                          <span
                            className={`badge ${order.paymentStatus === "PAID" ? "badge-success" : "badge-danger"}`}
                          >
                            {order.paymentStatus}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${statusMeta.badgeClass}`}>
                            {statusMeta.label}
                          </span>
                        </td>
                        <td style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                          {order.archivedAt
                            ? format(new Date(order.archivedAt), "MMM d, yyyy h:mm a")
                            : "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: "var(--space-2)" }}>
                            <Link
                              href={`/butigadmin/orders/${order.id}`}
                              className="btn btn-ghost btn-sm"
                            >
                              View
                            </Link>
                            {capabilities.manageOrders && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={busyId === order.id}
                                onClick={() =>
                                  void handleAction("order", order.id, order.reference, "restore")
                                }
                              >
                                Restore
                              </button>
                            )}
                            {capabilities.permanentDelete && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                style={{ color: "var(--color-error)" }}
                                disabled={busyId === order.id}
                                onClick={() =>
                                  void handleAction(
                                    "order",
                                    order.id,
                                    order.reference,
                                    "permanent_delete"
                                  )
                                }
                              >
                                Delete Forever
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {ordersPagination.totalPages > 1 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "var(--space-3) var(--space-4)",
                borderTop: "1px solid var(--color-neutral-200)",
                fontSize: "var(--text-xs)",
                color: "var(--color-neutral-600)",
              }}
            >
              <span>
                Showing page {ordersPagination.page} of {ordersPagination.totalPages} (
                {ordersPagination.total} archived orders)
              </span>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={orderPage <= 1}
                  onClick={() => setOrderPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={orderPage >= ordersPagination.totalPages}
                  onClick={() =>
                    setOrderPage((p) => Math.min(ordersPagination.totalPages, p + 1))
                  }
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      ) : activeTab === "batches" ? (
        <div className="table-wrapper">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Batch Name</th>
                  <th>Status</th>
                  <th>Products</th>
                  <th>Orders (Active / Cancelled)</th>
                  <th>Paid Revenue</th>
                  <th>Total Order Value</th>
                  <th>Archived</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredBatches.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-neutral-400)" }}>
                      No archived batches found.
                    </td>
                  </tr>
                ) : (
                  filteredBatches.map((batch) => {
                    const statusMeta = getBatchStatusMeta(batch.status);
                    return (
                      <tr key={batch.id}>
                        <td>
                          <div style={{ fontWeight: 700, color: "var(--color-neutral-900)" }}>
                            {batch.name}
                          </div>
                          {batch.description && (
                            <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                              {batch.description}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${statusMeta.badgeClass}`}>
                            {statusMeta.label}
                          </span>
                        </td>
                        <td>{batch.productCount}</td>
                        <td>
                          <strong>{batch.validOrderCount}</strong> active ·{" "}
                          <span style={{ color: "var(--color-neutral-500)" }}>
                            {batch.cancelledOrderCount} cancelled
                          </span>
                        </td>
                        <td style={{ fontWeight: 700, color: "var(--color-success)" }}>
                          {formatMoney(batch.paidRevenue)}
                        </td>
                        <td style={{ fontWeight: 600 }}>{formatMoney(batch.grossValue)}</td>
                        <td style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                          {batch.archivedAt
                            ? format(new Date(batch.archivedAt), "MMM d, yyyy h:mm a")
                            : "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: "var(--space-2)" }}>
                            {capabilities.manageBatches && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={busyId === batch.id}
                                onClick={() =>
                                  void handleAction("batch", batch.id, batch.name, "restore")
                                }
                              >
                                Restore
                              </button>
                            )}
                            {capabilities.permanentDelete && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                style={{ color: "var(--color-error)" }}
                                disabled={busyId === batch.id}
                                onClick={() =>
                                  void handleAction(
                                    "batch",
                                    batch.id,
                                    batch.name,
                                    "permanent_delete"
                                  )
                                }
                              >
                                Delete Forever
                              </button>
                            )}
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
      ) : (
        <div className="table-wrapper">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Unit Price</th>
                  <th>Units Sold (Paid / Total)</th>
                  <th>Paid Revenue</th>
                  <th>Total Ordered Value</th>
                  <th>Archived</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-neutral-400)" }}>
                      No archived products found.
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((product) => {
                    const thumb = product.images?.[0];
                    return (
                      <tr key={product.id}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                            {thumb && (
                              <img
                                src={imageUrlAtWidth(thumb, 400)}
                                alt={product.name}
                                style={{
                                  width: "40px",
                                  height: "40px",
                                  objectFit: "cover",
                                  borderRadius: "var(--radius-sm)",
                                  border: "1px solid var(--color-neutral-200)",
                                }}
                              />
                            )}
                            <div>
                              <div style={{ fontWeight: 700, color: "var(--color-neutral-900)" }}>
                                {product.name}
                              </div>
                              <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                                {product.variantCount} variant option(s)
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>{product.category || "—"}</td>
                        <td>{formatMoney(product.price, product.currency)}</td>
                        <td>
                          <strong>{product.paidUnits}</strong> paid / {product.unitsOrdered} ordered
                        </td>
                        <td style={{ fontWeight: 700, color: "var(--color-success)" }}>
                          {formatMoney(product.paidRevenue, product.currency)}
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          {formatMoney(product.totalRevenue, product.currency)}
                        </td>
                        <td style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                          {product.archivedAt
                            ? format(new Date(product.archivedAt), "MMM d, yyyy h:mm a")
                            : "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: "var(--space-2)" }}>
                            {capabilities.manageProducts && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={busyId === product.id}
                                onClick={() =>
                                  void handleAction(
                                    "product",
                                    product.id,
                                    product.name,
                                    "restore"
                                  )
                                }
                              >
                                Restore
                              </button>
                            )}
                            {capabilities.permanentDelete && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                style={{ color: "var(--color-error)" }}
                                disabled={busyId === product.id}
                                onClick={() =>
                                  void handleAction(
                                    "product",
                                    product.id,
                                    product.name,
                                    "permanent_delete"
                                  )
                                }
                              >
                                Delete Forever
                              </button>
                            )}
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
      )}
    </div>
  );
}
