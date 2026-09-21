"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  describeEta,
  etaState,
  fromDateTimeInputValue,
  toDateTimeInputValue,
} from "@/lib/batches";

/**
 * Batches: the supplier runs orders are grouped into.
 *
 * The screen answers one question — "what is going in the next run, and when is
 * it coming?" — so each row carries the two numbers that decide it (what the run
 * is worth, and how much of it is still unpaid) and how urgent its ETA is. The
 * date is the operator's to set, not the app's: it has no idea when a supplier
 * will deliver, and pretending otherwise would be invented certainty.
 */

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

/** The five states a batch can be in, as the API declares them. */
type BatchStatusValue = "DRAFT" | "SCHEDULED" | "OPEN" | "CLOSED" | "ARCHIVED";

const BATCH_STATUSES: BatchStatusValue[] = [
  "DRAFT",
  "SCHEDULED",
  "OPEN",
  "CLOSED",
  "ARCHIVED",
];

/** What each status means to the person choosing it. */
const STATUS_HINT: Record<BatchStatusValue, string> = {
  DRAFT: "Not finished yet. Hidden from customers.",
  SCHEDULED: "Announced, but not accepting orders yet.",
  OPEN: "Live: customers can order from this batch.",
  CLOSED: "Orders are in with the supplier.",
  ARCHIVED: "Finished. Kept for history, out of the way.",
};

/** A product that may be attached to a batch. */
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
  /** The ETA: the date the run is expected, stored as `endAt`. */
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
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BatchForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  // The catalogue, for the assignment list. Loaded once with the page.
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [uploading, setUploading] = useState(false);

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const load = async () => {
    try {
      const res = await fetch("/api/admin/batches");
      const json = await res.json();
      if (res.ok) setBatches(json.data ?? []);
      else showMsg("error", json.error?.message || "Failed to load batches");
    } catch {
      showMsg("error", "Failed to load batches");
    } finally {
      setLoading(false);
    }
  };

  /** The catalogue, for the "which products go in this run?" list. */
  const loadProducts = async () => {
    try {
      const res = await fetch("/api/admin/products?limit=100");
      if (!res.ok) return;
      const json = await res.json();
      setProducts(json.data?.products ?? []);
    } catch {
      // A failed catalogue load leaves the list empty. The rest of the screen
      // still works, and the assignment can be made once the API is back.
    }
  };

  useEffect(() => {
    // The loaders set state from their own promise callbacks, not synchronously
    // here, which is what this rule is looking for and cannot see through an
    // async function defined above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadProducts();
    // Both loaders are stable for the life of the screen: they read from the
    // server and write to state, and re-creating them would re-fetch on every
    // render. `load` is also called deliberately after a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Uploads a cover image and keeps the URL for the save.
   *
   * The file is sent on its own, before the batch is saved, so a slow upload
   * cannot turn into a lost form. Until the form is submitted the batch still
   * points at whatever it pointed at before.
   */
  const uploadCover = async (file: File) => {
    setUploading(true);
    try {
      const uploadData = new FormData();
      uploadData.append("file", file);
      // Batch covers are public storefront content, so the API asks for
      // batches.write for this purpose.
      uploadData.append("purpose", "BATCH_IMAGE");

      const res = await fetch("/api/upload", { method: "POST", body: uploadData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to upload the image");

      setForm((prev) => ({ ...prev, coverImage: json.data.url }));
      showMsg("success", "Cover image uploaded. Save the batch to keep it.");
    } catch (err) {
      showMsg("error", err instanceof Error ? err.message : "Failed to upload the image");
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
            // `datetime-local` is a local wall-clock time; the helper resolves it
            // in the operator's own timezone, which is where they typed it. Doing
            // this with `toISOString()` instead shifted every date by the offset
            // on every save.
            startAt: fromDateTimeInputValue(form.startAt),
            etaAt: fromDateTimeInputValue(form.etaAt),
            coverImage: form.coverImage,
            productIds: form.productIds,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to save the batch");

      await load();
      setForm(EMPTY_FORM);
      setEditingId(null);
      setCreating(false);
      showMsg("success", editingId ? "Batch updated." : "Batch created.");
    } catch (err) {
      showMsg("error", err instanceof Error ? err.message : "Failed to save the batch");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (batch: BatchRow) => {
    // The API refuses to delete a batch that has orders, because an order whose
    // batch is gone is an order nobody will ever make. Saying so here, instead of
    // promising to ungroup them, is the difference between a dialog and a lie.
    if (batch.orderCount > 0) {
      showMsg(
        "error",
        `"${batch.name}" has ${batch.orderCount} order(s), so it cannot be deleted. Edit it and set its status to Archived instead.`
      );
      return;
    }

    const confirmed = window.confirm(`Delete "${batch.name}"? This cannot be undone.`);
    if (!confirmed) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/batches/${batch.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to delete the batch");
      await load();
      showMsg("success", "Batch deleted.");
    } catch (err) {
      showMsg("error", err instanceof Error ? err.message : "Failed to delete the batch");
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
      none: "badge-closed",
      scheduled: "badge-confirmed",
      soon: "badge-coming",
      arrived: "badge-pending",
    };
    return <span className={`badge ${map[state]}`}>{describeEta(batch.etaAt)}</span>;
  };

  const batchForm = (
    <div className="card" style={{ background: "var(--color-neutral-50)", marginTop: "var(--space-4)" }}>
      <div className="card-body">
        <h3 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-4)" }}>
          {editingId ? "Edit batch" : "New batch"}
        </h3>

        <div className="form-group">
          <label className="form-label">Name</label>
          <input
            className="form-input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Batch 1 — October"
            maxLength={80}
          />
        </div>

        <div className="form-group" style={{ marginTop: "var(--space-3)" }}>
          <label className="form-label">Status</label>
          <select
            className="form-input"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as BatchStatusValue })}
          >
            {BATCH_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)", marginTop: "var(--space-1)" }}>
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
          <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)", marginTop: "var(--space-1)" }}>
            When this run starts taking orders. Leave blank to start as soon as the
            status is Open.
          </p>
        </div>

        <div className="form-group" style={{ marginTop: "var(--space-3)" }}>
          <label className="form-label">Expected arrival (ETA)</label>
          <input
            type="datetime-local"
            className="form-input"
            value={form.etaAt}
            onChange={(e) => setForm({ ...form, etaAt: e.target.value })}
          />
          <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)", marginTop: "var(--space-1)" }}>
            Leave blank until the supplier confirms a date. Customers are only ever told
            what you put here.
          </p>
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
              // The admin preview of a stored upload. next/image would need every
              // possible remote host configured, and this screen is internal to the
              // operator; the storefront renders covers through its own component.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.coverImage}
                alt=""
                style={{ width: "72px", height: "72px", objectFit: "cover", borderRadius: "var(--radius-md)" }}
              />
            ) : (
              <div style={{
                width: "72px", height: "72px", borderRadius: "var(--radius-md)",
                background: "var(--color-neutral-100)", display: "flex",
                alignItems: "center", justifyContent: "center",
                color: "var(--color-neutral-400)", fontSize: "var(--text-xs)",
              }}>
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
                  // Cleared so picking the same file twice still fires a change.
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
              <span style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)" }}>
                {uploading ? "Uploading…" : "JPG, PNG or WebP, up to 5MB. Re-encoded on upload."}
              </span>
            </div>
          </div>
        </div>

        <div className="form-group" style={{ marginTop: "var(--space-3)" }}>
          <label className="form-label">Products in this run</label>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)", marginBottom: "var(--space-2)" }}>
            Customers can only order what is ticked here. An empty batch shows nothing.
          </p>
          {products.length === 0 ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)" }}>
              No products yet. <Link href="/admin/products/new" style={{ color: "var(--color-brand-600)", fontWeight: 600 }}>Add one</Link> first.
            </p>
          ) : (
            <div style={{ display: "grid", gap: "var(--space-2)", maxHeight: "260px", overflowY: "auto" }}>
              {products.map((product) => (
                <label
                  key={product.id}
                  style={{
                    display: "flex", alignItems: "center", gap: "var(--space-2)",
                    padding: "var(--space-2) var(--space-3)",
                    border: `1px solid ${form.productIds.includes(product.id) ? "var(--color-brand-500)" : "var(--color-neutral-200)"}`,
                    borderRadius: "var(--radius-md)", cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.productIds.includes(product.id)}
                    onChange={() => toggleProduct(product.id)}
                    style={{ width: "18px", height: "18px", accentColor: "var(--color-brand-500)", flexShrink: 0 }}
                  />
                  <span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{product.name}</span>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                    ₱{Number(product.price).toLocaleString()} · {product.category || "no category"} · {product.variants?.length || 0} variant(s)
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-5)" }}>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy || uploading || form.name.trim() === ""}>
            {busy ? "Saving…" : editingId ? "Save changes" : "Create batch"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={resetForm} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="admin-page-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Batches</span>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          {!creating && !editingId && (
            <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setCreating(true); }} disabled={busy}>
              + New batch
            </button>
          )}
        </div>
      </div>

      {message && (
        <div
          role={message.type === "error" ? "alert" : undefined}
          style={{
            padding: "var(--space-3) var(--space-4)",
            background: message.type === "success" ? "rgb(22 163 74 / 0.08)" : "rgb(220 38 38 / 0.08)",
            border: `1px solid ${message.type === "success" ? "rgb(22 163 74 / 0.3)" : "rgb(220 38 38 / 0.3)"}`,
            borderRadius: "var(--radius-lg)",
            color: message.type === "success" ? "var(--color-success)" : "var(--color-error)",
            fontWeight: 500,
            marginBottom: "var(--space-4)",
          }}
        >
          {message.type === "success" ? "✓" : "⚠"} {message.text}
        </div>
      )}

      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", marginBottom: "var(--space-5)", maxWidth: "720px" }}>
        A batch is one supplier run. Group the orders that will be made together, set the
        date you expect them, and export the list when you place the order.
      </p>

      <div className="table-wrapper">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>ETA</th>
                <th>Orders</th>
                <th>Value</th>
                <th>Unpaid</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "var(--space-8)" }}>Loading...</td>
                </tr>
              ) : batches.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-neutral-500)" }}>
                    No batches yet. Create one when you place your next supplier order.
                  </td>
                </tr>
              ) : batches.map((batch) => (
                <tr key={batch.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{batch.name}</div>
                    {batch.notes && (
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                        {batch.notes}
                      </div>
                    )}
                    {batch.createdAt && (
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)" }}>
                        created {format(new Date(batch.createdAt), "MMM d, yyyy")}
                      </div>
                    )}
                  </td>
                  <td>{etaBadge(batch)}</td>
                  <td style={{ fontWeight: 600 }}>{batch.orderCount}</td>
                  <td>₱{Number(batch.totalValue).toLocaleString()}</td>
                  <td>
                    {batch.unpaidCount > 0 ? (
                      <span className="badge badge-pending">{batch.unpaidCount} unpaid</span>
                    ) : (
                      <span className="badge badge-confirmed">all paid</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                      <Link href={`/preorder/${batch.slug}`} target="_blank" className="btn btn-ghost btn-sm">
                        Preview
                      </Link>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Copy the customer pre-order link"
                        onClick={() => {
                          const url = `${window.location.origin}/preorder/${batch.slug}`;
                          void navigator.clipboard
                            .writeText(url)
                            .then(() => showMsg("success", `Copied ${url}`));
                        }}
                      >
                        Copy link
                      </button>
                      <Link
                        href={`/admin/orders?batchId=${batch.id}`}
                        className="btn btn-ghost btn-sm"
                      >
                        Orders
                      </Link>
                      <a
                        href={`/api/admin/orders/export?batchId=${batch.id}`}
                        className="btn btn-ghost btn-sm"
                      >
                        Export
                      </a>
                      <button className="btn btn-ghost btn-sm" onClick={() => beginEdit(batch)} disabled={busy}>
                        Edit
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => remove(batch)}
                        disabled={busy}
                        style={{ color: "var(--color-error)" }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(creating || editingId) && batchForm}
    </div>
  );
}

