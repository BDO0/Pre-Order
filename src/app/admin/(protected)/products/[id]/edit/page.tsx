"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    category: "",
    price: "",
    preorderStatus: "OPEN",
    active: true,
    sizes: "",
    color: "",
  });

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const res = await fetch(`/api/admin/products/${id}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || "Failed to load product");

        const p = json.data;
        // Extract unique sizes and single color from variants (simplified)
        const sizes = [...new Set((p.variants || []).map((v: any) => v.size).filter(Boolean))].join(", ");
        const firstColor = (p.variants || [])[0]?.color || "";

        setFormData({
          name: p.name,
          category: p.category || "",
          price: String(p.price),
          preorderStatus: p.preorderStatus,
          active: p.active,
          sizes,
          color: firstColor,
        });
      } catch (err: any) {
        setError(err.message);
      } finally {
        setFetching(false);
      }
    };
    fetchProduct();
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const sizeList = formData.sizes.split(",").map(s => s.trim()).filter(Boolean);
      const variants = sizeList.map(size => ({ size, color: formData.color || undefined }));

      const res = await fetch(`/api/admin/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          category: formData.category,
          price: Number(formData.price),
          active: formData.active,
          preorderStatus: formData.preorderStatus,
          variants: variants.length > 0 ? variants : undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to update product");

      setSuccess("Product updated successfully!");
      setTimeout(() => router.push("/admin/products"), 1200);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-16)", color: "var(--color-neutral-500)" }}>
        Loading product...
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "var(--space-6)" }}>
        <Link href="/admin/products" style={{ fontSize: "var(--text-sm)", color: "var(--color-brand-600)", textDecoration: "none", fontWeight: 500 }}>
          ← Back to Products
        </Link>
        <h1 className="admin-page-title" style={{ marginTop: "var(--space-2)", marginBottom: 0 }}>Edit Product</h1>
      </div>

      {error && (
        <div style={{ padding: "var(--space-3) var(--space-4)", background: "rgb(220 38 38 / 0.08)", border: "1px solid rgb(220 38 38 / 0.3)", borderRadius: "var(--radius-lg)", color: "var(--color-error)", marginBottom: "var(--space-4)", fontWeight: 500 }}>
          ⚠ {error}
        </div>
      )}
      {success && (
        <div style={{ padding: "var(--space-3) var(--space-4)", background: "rgb(22 163 74 / 0.08)", border: "1px solid rgb(22 163 74 / 0.3)", borderRadius: "var(--radius-lg)", color: "var(--color-success)", marginBottom: "var(--space-4)", fontWeight: 500 }}>
          ✓ {success}
        </div>
      )}

      <div className="card" style={{ maxWidth: "640px" }}>
        <div className="card-body">
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>

            <div className="form-group">
              <label className="form-label form-label-required">Product Name</label>
              <input required type="text" className="form-input" value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
              <div className="form-group">
                <label className="form-label form-label-required">Category</label>
                <input required type="text" className="form-input" value={formData.category}
                  onChange={e => setFormData({ ...formData, category: e.target.value })}
                  placeholder="e.g. Tops, Bottoms" />
              </div>
              <div className="form-group">
                <label className="form-label form-label-required">Price (₱)</label>
                <input required type="number" min="0" step="0.01" className="form-input" value={formData.price}
                  onChange={e => setFormData({ ...formData, price: e.target.value })} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label form-label-required">Pre-Order Status</label>
              <select required className="form-input" value={formData.preorderStatus}
                onChange={e => setFormData({ ...formData, preorderStatus: e.target.value })}>
                <option value="OPEN">Open — Customers can order this</option>
                <option value="COMING_SOON">Coming Soon — Visible but not orderable yet</option>
                <option value="SOLD_OUT">Sold Out — Show as unavailable</option>
                <option value="CLOSED">Closed</option>
                <option value="DISABLED">Disabled — Hidden from customers</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label form-label-required">Sizes (comma separated)</label>
              <input required type="text" className="form-input" value={formData.sizes}
                onChange={e => setFormData({ ...formData, sizes: e.target.value })}
                placeholder="S, M, L, XL" />
              <span className="form-hint">⚠ Editing sizes will replace all existing variants.</span>
            </div>

            <div className="form-group">
              <label className="form-label">Color (Optional)</label>
              <input type="text" className="form-input" value={formData.color}
                onChange={e => setFormData({ ...formData, color: e.target.value })}
                placeholder="e.g. Black" />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)", background: "var(--color-neutral-50)", borderRadius: "var(--radius-lg)", border: "1px solid var(--color-neutral-200)" }}>
              <input
                type="checkbox"
                id="active-toggle"
                checked={formData.active}
                onChange={e => setFormData({ ...formData, active: e.target.checked })}
                style={{ width: "18px", height: "18px", accentColor: "var(--color-brand-500)" }}
              />
              <label htmlFor="active-toggle" style={{ fontSize: "var(--text-sm)", fontWeight: 600, cursor: "pointer", color: "var(--color-neutral-700)" }}>
                Product is Active (visible to admin, available for campaigns)
              </label>
            </div>

            <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-2)" }}>
              <Link href="/admin/products" className="btn btn-secondary" style={{ flex: 1, justifyContent: "center" }}>Cancel</Link>
              <button type="submit" disabled={loading} className="btn btn-primary" style={{ flex: 2 }}>
                {loading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
