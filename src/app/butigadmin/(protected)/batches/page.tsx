"use client";
import { formatMoney } from "@/lib/format";
import { useState, useEffect } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  describeEta,
  etaState,
  fromDateTimeInputValue,
  toDateTimeInputValue,
} from "@/lib/batches";
import {
  compressImageClient,
  formatFileSize,
  heifUploadHint,
} from "@/lib/client-image-compression";
import { parseApiResponse } from "@/lib/api-client";
import { copyTextToClipboard } from "@/lib/clipboard";
import { getBatchStatusMeta } from "@/lib/order-status-meta";
import adminStyles from "../admin.module.css";

interface BatchRow {
  id: string;
  name: string;
  slug: string;
  notes: string | null;
  etaAt: string | null;
  startAt: string | null;
  status: BatchStatusValue;
  coverImage: string | null;
  createdAt: string;
  orderCount: number;
  totalValue: number;
  unpaidCount: number;
  products: { productId: string }[];
}
type BatchStatusValue = "DRAFT" | "SCHEDULED" | "OPEN" | "CLOSED" | "ARCHIVED";
const BATCH_STATUSES: BatchStatusValue[] = [
  "DRAFT",
  "SCHEDULED",
  "OPEN",
  "CLOSED",
  "ARCHIVED",
];
const STATUS_HINT: Record<BatchStatusValue, string> = {
  DRAFT: "Not finished yet. Hidden from customers.",
  SCHEDULED: "Announced, but not accepting orders yet.",
  OPEN: "Live: customers can order from this batch.",
  CLOSED: "Orders are in with the supplier.",
  ARCHIVED: "Finished. Kept for history, out of the way.",
};
interface ProductOption {
  id: string;
  name: string;
  price: number;
  category: string | null;
  variants: { id: string }[];
}
interface BatchForm {
  name: string;
  status: BatchStatusValue;
  startAt: string;
  etaAt: string;
  notes: string;
  coverImage: string | null;
  productIds: string[];
}
const EMPTY_FORM: BatchForm = {
  name: "",
  status: "OPEN",
  startAt: "",
  etaAt: "",
  notes: "",
  coverImage: null,
  productIds: [],
};

export default function AdminBatchesPage() {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BatchForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [uploading, setUploading] = useState(false);
  const [copiedBatchId, setCopiedBatchId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const drawerOpen = creating || Boolean(editingId);

  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenuId]);

  useEffect(() => {
    if (!drawerOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        setForm(EMPTY_FORM);
        setEditingId(null);
        setCreating(false);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [drawerOpen, busy]);

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleCopyLink = async (batch: BatchRow) => {
    const url = `${window.location.origin}/preorder/${batch.slug}`;
    const success = await copyTextToClipboard(url);
    if (success) {
      setCopiedBatchId(batch.id);
      setTimeout(() => {
        setCopiedBatchId((curr) => (curr === batch.id ? null : curr));
      }, 2500);

      if (batch.status === "DRAFT") {
        showMsg(
          "success",
          `Copied ${url} — Notice: Batch is currently in DRAFT. Change status to OPEN before sharing with customers.`
        );
      } else if (batch.status === "CLOSED" || batch.status === "ARCHIVED") {
        showMsg(
          "success",
          `Copied ${url} — Notice: Batch is ${batch.status}. Customers cannot place new orders.`
        );
      } else {
        showMsg("success", `Copied customer link: ${url}`);
      }
    } else {
      showMsg("error", `Could not automatically copy to clipboard. URL: ${url}`);
    }
  };

  const load = async () => {
    try {
      const res = await fetch("/api/admin/batches");
      const { ok, data, error } = await parseApiResponse(
        res,
        "Failed to load batches"
      );
      if (ok && data) setBatches(data);
      else showMsg("error", error || "Failed to load batches");
    } catch {
      showMsg("error", "Failed to load batches");
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async () => {
    try {
      const res = await fetch("/api/admin/products?limit=100");
      const { ok, data } = await parseApiResponse(res);
      if (ok && data) {
        setProducts(data.products ?? []);
      }
    } catch {}
  };

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    void load();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (drawerOpen && products.length === 0) {
      void loadProducts();
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [drawerOpen, products.length]);

  const uploadCover = async (file: File) => {
    setUploading(true);
    try {
      let compressed;
      try {
        compressed = await compressImageClient(file);
      } catch (err) {
        const hint = heifUploadHint(file);
        if (hint) throw new Error(hint);
        throw err;
      }
      URL.revokeObjectURL(compressed.previewUrl);
      const uploadData = new FormData();
      uploadData.append("file", compressed.file);
      uploadData.append("purpose", "BATCH_IMAGE");
      const res = await fetch("/api/upload", {
        method: "POST",
        body: uploadData,
      });
      const { ok, data, error } = await parseApiResponse(
        res,
        "Failed to upload the image"
      );
      if (!ok || !data) throw new Error(error || "Failed to upload the image");
      setForm((prev) => ({ ...prev, coverImage: data.url }));
      showMsg(
        "success",
        `Cover image optimized & uploaded (${formatFileSize(compressed.originalBytes)} → ${formatFileSize(compressed.compressedBytes)}, ${compressed.savingsPercent}% saved). Save the batch to keep it.`
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof Error ? err.message : "Failed to upload the image"
      );
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        editingId ? `/api/admin/batches/${editingId}` : "/api/admin/batches",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            status: form.status,
            notes: form.notes || null,
            startAt: fromDateTimeInputValue(form.startAt),
            etaAt: fromDateTimeInputValue(form.etaAt),
            coverImage: form.coverImage,
            productIds: form.productIds,
          }),
        }
      );
      const { ok, error } = await parseApiResponse(
        res,
        "Failed to save the batch"
      );
      if (!ok) throw new Error(error || "Failed to save the batch");
      await load();
      setForm(EMPTY_FORM);
      setEditingId(null);
      setCreating(false);
      showMsg("success", editingId ? "Batch updated." : "Batch created.");
    } catch (err) {
      showMsg(
        "error",
        err instanceof Error ? err.message : "Failed to save the batch"
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (batch: BatchRow) => {
    const prompt =
      batch.orderCount > 0
        ? `Permanently delete "${batch.name}" and ALL ${batch.orderCount} order(s) in this batch?\n\nThis will remove them from the database permanently. This cannot be undone.`
        : `Permanently delete "${batch.name}"? This cannot be undone.`;
    const confirmed = window.confirm(prompt);
    if (!confirmed) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/batches/${batch.id}`, {
        method: "DELETE",
      });
      const { ok, error } = await parseApiResponse(
        res,
        "Failed to delete the batch"
      );
      if (!ok) throw new Error(error || "Failed to delete the batch");
      await load();
      showMsg("success", "Batch and associated orders deleted permanently.");
    } catch (err) {
      showMsg(
        "error",
        err instanceof Error ? err.message : "Failed to delete the batch"
      );
    } finally {
      setBusy(false);
    }
  };

  const markShipped = async (batch: BatchRow) => {
    const confirmed = window.confirm(
      `Mark all accepted orders in "${batch.name}" as Shipped?`
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/batches/${batch.id}/ship`, {
        method: "POST",
      });
      const { ok, data, error } = await parseApiResponse(
        res,
        "Failed to mark orders as shipped"
      );
      if (!ok) throw new Error(error || "Failed to mark orders as shipped");
      const count = data?.updatedCount ?? 0;
      showMsg(
        "success",
        count > 0
          ? `Marked ${count} order(s) as Shipped.`
          : "No accepted orders to ship in this batch."
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof Error ? err.message : "Failed to mark orders as shipped"
      );
    } finally {
      setBusy(false);
    }
  };

  const beginEdit = (batch: BatchRow) => {
    setCreating(false);
    setEditingId(batch.id);
    setForm({
      name: batch.name,
      status: batch.status,
      startAt: toDateTimeInputValue(batch.startAt),
      etaAt: toDateTimeInputValue(batch.etaAt),
      notes: batch.notes ?? "",
      coverImage: batch.coverImage,
      productIds: batch.products.map((entry) => entry.productId),
    });
  };

  const toggleProduct = (productId: string) => {
    setForm((prev) => ({
      ...prev,
      productIds: prev.productIds.includes(productId)
        ? prev.productIds.filter((id) => id !== productId)
        : [...prev.productIds, productId],
    }));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setCreating(false);
  };

  const etaBadge = (batch: BatchRow) => {
    const state = etaState(batch.etaAt);
    const map: Record<ReturnType<typeof etaState>, string> = {
      none: "badge-neutral",
      scheduled: "badge-info",
      soon: "badge-amber",
      arrived: "badge-success",
    };
    return (
      <span className={`badge ${map[state]}`}>{describeEta(batch.etaAt)}</span>
    );
  };

  return (
    <div>
      <div
        className="admin-page-title"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>Batches</span>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            resetForm();
            setCreating(true);
          }}
          disabled={busy}
        >
          + New batch
        </button>
      </div>

      {message && (
        <div
          role={message.type === "error" ? "alert" : undefined}
          style={{
            padding: "var(--space-3) var(--space-4)",
            background:
              message.type === "success"
                ? "rgb(22 163 74 / 0.08)"
                : "rgb(220 38 38 / 0.08)",
            border: `1px solid ${message.type === "success" ? "rgb(22 163 74 / 0.3)" : "rgb(220 38 38 / 0.3)"}`,
            borderRadius: "var(--radius-lg)",
            color:
              message.type === "success"
                ? "var(--color-success)"
                : "var(--color-error)",
            fontWeight: 500,
            marginBottom: "var(--space-4)",
          }}
        >
          {message.text}
        </div>
      )}

      <div className="table-wrapper">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Status</th>
                <th>ETA</th>
                <th>Products</th>
                <th>Orders</th>
                <th>Value</th>
                <th>Unpaid</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "var(--space-8)" }}>
                    Loading...
                  </td>
                </tr>
              ) : batches.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    style={{
                      textAlign: "center",
                      padding: "var(--space-8)",
                      color: "var(--color-neutral-500)",
                    }}
                  >
                    No batches yet. Create one when you place your next supplier order.
                  </td>
                </tr>
              ) : (
                batches.map((batch) => {
                  const statusMeta = getBatchStatusMeta(batch.status);
                  const isMenuOpen = openMenuId === batch.id;
                  return (
                    <tr key={batch.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{batch.name}</div>
                        {batch.notes && (
                          <div
                            style={{
                              fontSize: "var(--text-xs)",
                              color: "var(--color-neutral-500)",
                            }}
                          >
                            {batch.notes}
                          </div>
                        )}
                        {batch.createdAt && (
                          <div
                            style={{
                              fontSize: "var(--text-xs)",
                              color: "var(--color-neutral-400)",
                            }}
                          >
                            created {format(new Date(batch.createdAt), "MMM d, yyyy")}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${statusMeta.badgeClass}`}>
                          {statusMeta.label}
                        </span>
                      </td>
                      <td>{etaBadge(batch)}</td>
                      <td>
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-600)", fontWeight: 600 }}>
                          {batch.products.length} piece{batch.products.length === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{batch.orderCount}</td>
                      <td>{formatMoney(Number(batch.totalValue))}</td>
                      <td>
                        {batch.unpaidCount > 0 ? (
                          <span className="badge badge-amber">
                            {batch.unpaidCount} unpaid
                          </span>
                        ) : (
                          <span className="badge badge-success">all paid</span>
                        )}
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
                          <Link
                            href={`/butigadmin/orders?tab=all&batchId=${batch.id}`}
                            className="btn btn-secondary btn-sm"
                          >
                            Orders
                          </Link>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => beginEdit(batch)}
                            disabled={busy}
                          >
                            Edit
                          </button>

                          <div
                            className={adminStyles.overflowWrap}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-label="More batch actions"
                              aria-expanded={isMenuOpen}
                              onClick={() =>
                                setOpenMenuId(isMenuOpen ? null : batch.id)
                              }
                            >
                              ⋯
                            </button>
                            {isMenuOpen && (
                              <div className={adminStyles.overflowMenu} role="menu">
                                <Link
                                  href={`/preorder/${batch.slug}`}
                                  target="_blank"
                                  className={adminStyles.overflowItem}
                                  onClick={() => setOpenMenuId(null)}
                                >
                                  Preview Drop ↗
                                </Link>
                                <button
                                  type="button"
                                  className={adminStyles.overflowItem}
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    void handleCopyLink(batch);
                                  }}
                                >
                                  {copiedBatchId === batch.id
                                    ? "Copied Link ✓"
                                    : "Copy Customer Link"}
                                </button>
                                <a
                                  href={`/api/admin/orders/export?batchId=${batch.id}`}
                                  className={adminStyles.overflowItem}
                                  onClick={() => setOpenMenuId(null)}
                                >
                                  Export CSV
                                </a>
                                <button
                                  type="button"
                                  className={adminStyles.overflowItem}
                                  disabled={busy}
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    void markShipped(batch);
                                  }}
                                >
                                  Mark All Shipped
                                </button>
                                <button
                                  type="button"
                                  className={`${adminStyles.overflowItem} ${adminStyles.overflowItemDanger}`}
                                  disabled={busy}
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    void remove(batch);
                                  }}
                                >
                                  Delete Batch
                                </button>
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

      {drawerOpen && (
        <div
          className={adminStyles.drawerBackdrop}
          onClick={() => !busy && resetForm()}
        >
          <div
            className={adminStyles.drawerPanel}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="batch-drawer-title"
          >
            <div className={adminStyles.drawerHeader}>
              <h2
                id="batch-drawer-title"
                style={{ fontSize: "var(--text-lg)", fontWeight: 700, margin: 0 }}
              >
                {editingId ? "Edit Batch" : "New Batch"}
              </h2>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={resetForm}
                disabled={busy}
                aria-label="Close drawer"
              >
                ✕
              </button>
            </div>
            <div className={adminStyles.drawerBody}>
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Batch 1 — October"
                  maxLength={80}
                  autoFocus
                />
              </div>
              <div className="form-group" style={{ marginTop: "var(--space-3)" }}>
                <label className="form-label">Status</label>
                <select
                  className="form-input"
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as BatchStatusValue })
                  }
                >
                  {BATCH_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <p className="form-hint" style={{ marginTop: "var(--space-1)" }}>
                  {STATUS_HINT[form.status]}
                </p>
              </div>
              <div className="form-group" style={{ marginTop: "var(--space-3)" }}>
                <label className="form-label">Orders open at (optional)</label>
                <input
                  type="datetime-local"
                  className="form-input"
                  value={form.startAt}
                  onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ marginTop: "var(--space-3)" }}>
                <label className="form-label">Expected arrival (ETA)</label>
                <input
                  type="datetime-local"
                  className="form-input"
                  value={form.etaAt}
                  onChange={(e) => setForm({ ...form, etaAt: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ marginTop: "var(--space-3)" }}>
                <label className="form-label">Notes (internal)</label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  maxLength={500}
                  placeholder="Supplier, tracking, anything worth remembering"
                />
              </div>
              <div className="form-group" style={{ marginTop: "var(--space-3)" }}>
                <label className="form-label">Cover image</label>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                  {form.coverImage ? (
                    <img
                      src={form.coverImage}
                      alt=""
                      style={{
                        width: "72px",
                        height: "72px",
                        objectFit: "cover",
                        borderRadius: "var(--radius-md)",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "72px",
                        height: "72px",
                        borderRadius: "var(--radius-md)",
                        background: "var(--color-neutral-100)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--color-neutral-400)",
                        fontSize: "var(--text-xs)",
                      }}
                    >
                      none
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadCover(file);
                        e.target.value = "";
                      }}
                      style={{ fontSize: "var(--text-sm)" }}
                    />
                    {form.coverImage && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setForm({ ...form, coverImage: null })}
                        style={{ alignSelf: "flex-start", color: "var(--color-error)" }}
                      >
                        Remove
                      </button>
                    )}
                    <span className="form-hint">
                      {uploading
                        ? "Uploading…"
                        : "JPG, PNG or WebP, up to 5MB. Re-encoded on upload."}
                    </span>
                  </div>
                </div>
              </div>
              <div className="form-group" style={{ marginTop: "var(--space-3)" }}>
                <label className="form-label">Products in this run</label>
                {products.length === 0 ? (
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)" }}>
                    No products yet.{" "}
                    <Link
                      href="/butigadmin/products/new"
                      style={{ color: "var(--color-brand-600)", fontWeight: 600 }}
                    >
                      Add one
                    </Link>{" "}
                    first.
                  </p>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gap: "var(--space-2)",
                      maxHeight: "240px",
                      overflowY: "auto",
                    }}
                  >
                    {products.map((product) => (
                      <label
                        key={product.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-2)",
                          padding: "var(--space-2) var(--space-3)",
                          border: `1px solid ${form.productIds.includes(product.id) ? "var(--color-brand-500)" : "var(--color-neutral-200)"}`,
                          borderRadius: "var(--radius-md)",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={form.productIds.includes(product.id)}
                          onChange={() => toggleProduct(product.id)}
                          style={{
                            width: "18px",
                            height: "18px",
                            accentColor: "var(--color-brand-500)",
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
                          {product.name}
                        </span>
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                          {formatMoney(Number(product.price))} ·{" "}
                          {product.category || "no category"} ·{" "}
                          {product.variants?.length || 0} variant(s)
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "var(--space-2)",
                  marginTop: "var(--space-6)",
                  paddingTop: "var(--space-4)",
                  borderTop: "1px solid var(--color-neutral-200)",
                }}
              >
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={resetForm}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={submit}
                  disabled={busy || uploading || form.name.trim() === ""}
                >
                  {busy ? "Saving…" : editingId ? "Save changes" : "Create batch"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
