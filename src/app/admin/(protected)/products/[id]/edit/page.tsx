"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * The product this form edits, as `GET /api/admin/products/[id]` returns it.
 *
 * `images` is deliberately `unknown`: the endpoint passes the column through as
 * stored, and the form validates it with `Array.isArray` before using it, so a
 * non-array value degrades to "no images" instead of crashing the screen.
 */
interface ProductDetail {
  name: string;
  category: string | null;
  price: string | number;
  preorderStatus: string;
  active: boolean;
  images: unknown;
  variants?: { size: string; color: string | null }[];
}

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
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const res = await fetch(`/api/admin/products/${id}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || "Failed to load product");

        const p = json.data as ProductDetail;
        // Extract unique sizes and single color from variants (simplified)
        const sizes = [...new Set((p.variants || []).map((v) => v.size).filter(Boolean))].join(", ");
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
        setExistingImages(Array.isArray(p.images) ? (p.images as string[]) : []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load product");
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
      let finalImages = existingImages;

      // If a new image file was selected, upload it first
      if (imageFile) {
        const uploadData = new FormData();
        uploadData.append("file", imageFile);
        uploadData.append("purpose", "PRODUCT_IMAGE");
        const uploadRes = await fetch("/api/upload", { method: "POST", body: uploadData });
        const uploadJson = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadJson.error?.message || "Failed to upload image.");
        finalImages = [uploadJson.data.url];
      }

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
          images: finalImages,
          // Always sent, even when the list is empty. Leaving the key out used
          // to mean "the variants are not what this screen is editing", so
          // clearing the field and saving changed nothing at all - while the hint
          // below promised the sizes would be replaced. An empty list now says
          // what it means: this product has no sizes.
          variants,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to update product");

      // Say what happened to the sizes. "Product updated" was true but useless
      // when saving the form had just retired two of them.
      const changes = json.meta?.variantChanges as
        | { created: number; updated: number; retired: number }
        | null
        | undefined;
      const retired = changes?.retired ?? 0;

      setSuccess(
        retired > 0
          ? `Product updated. ${retired} size${retired === 1 ? "" : "s"} retired; their past orders are untouched.`
          : "Product updated successfully!"
      );
      setTimeout(() => router.push("/admin/products"), 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update product");
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
              <span className="form-hint">⚠ Saving replaces the size list. A size you remove is retired, not deleted,
so its past orders still count and you can add it back.</span>
            </div>

            <div className="form-group">
              <label className="form-label">Color (Optional)</label>
              <input type="text" className="form-input" value={formData.color}
                onChange={e => setFormData({ ...formData, color: e.target.value })}
                placeholder="e.g. Black" />
            </div>

            {/* Product Image */}
            <div className="form-group">
              <label className="form-label">Product Image</label>
              {existingImages[0] && (
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-2)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={existingImages[0]}
                    alt={formData.name}
                    style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "var(--radius-md)", border: "1px solid var(--color-neutral-200)" }}
                  />
                  <div>
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-600)", fontWeight: 500, margin: 0 }}>
                      Current Image
                    </p>
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)", margin: 0 }}>
                      Select a file below to replace it.
                    </p>
                  </div>
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                className="form-input"
                onChange={e => setImageFile(e.target.files?.[0] || null)}
              />
              <span className="form-hint">Upload JPG, PNG or WebP to update product imagery.</span>
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
                Product is Active (visible to admin, available for batches)
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
