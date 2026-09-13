"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewProductPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    category: "",
    price: "",
    sizes: "S, M, L, XL", // Simple text input for sizes
    colors: "Black",
  });

  const [imageFile, setImageFile] = useState<File | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // 1. Upload image if exists
      let imageUrl = "";
      if (imageFile) {
        const uploadData = new FormData();
        uploadData.append("file", imageFile);
        // Product imagery is public storefront content, so it lands in
        // public/uploads and the API requires products.write for this purpose.
        uploadData.append("purpose", "PRODUCT_IMAGE");
        const uploadRes = await fetch("/api/upload", { method: "POST", body: uploadData });
        const uploadJson = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadJson.error?.message || "Failed to upload image.");
        imageUrl = uploadJson.data.url;
      }

      // 2. Generate slug
      const slug = formData.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

      // 3. Create product
      const res = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          slug,
          category: formData.category,
          price: Number(formData.price),
          images: imageUrl ? [imageUrl] : [],
          active: true,
          preorderEnabled: true,
          preorderStatus: "OPEN",
          // Send custom variants field to be processed by our API
          variants: formData.sizes.split(",").map(s => s.trim()).filter(Boolean).map(size => ({
            size,
            color: formData.colors,
            active: true
          }))
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to create product");

      router.push("/admin/products");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: "var(--space-6)" }}>
        <Link href="/admin/products" style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", textDecoration: "none" }}>
          ← Back to Products
        </Link>
        <h1 className="admin-page-title" style={{ marginTop: "var(--space-2)" }}>Add New Product</h1>
      </div>

      <div className="card" style={{ maxWidth: "600px" }}>
        <div className="card-body">
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            
            <div className="form-group">
              <label className="form-label form-label-required">Product Name</label>
              <input required type="text" className="form-input" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. ANA Basic Tee" />
            </div>

            <div style={{ display: "flex", gap: "var(--space-4)" }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label form-label-required">Category</label>
                <input required type="text" className="form-input" value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })} placeholder="e.g. Tops" />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label form-label-required">Base Price (₱)</label>
                <input required type="number" min="0" className="form-input" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} placeholder="500" />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label form-label-required">Sizes (comma separated)</label>
              <input required type="text" className="form-input" value={formData.sizes} onChange={e => setFormData({ ...formData, sizes: e.target.value })} placeholder="S, M, L, XL" />
              <span className="form-hint">These will be generated as selectable options for the customer.</span>
            </div>

            <div className="form-group">
              <label className="form-label form-label-required">Color</label>
              <input required type="text" className="form-input" value={formData.colors} onChange={e => setFormData({ ...formData, colors: e.target.value })} placeholder="Black" />
            </div>

            <div className="form-group">
              <label className="form-label">Product Image</label>
              <input type="file" accept="image/*" onChange={e => setImageFile(e.target.files?.[0] || null)} className="form-input" style={{ padding: "var(--space-2)" }} />
            </div>

            {error && <div className="form-error">⚠ {error}</div>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-4)", marginTop: "var(--space-4)" }}>
              <Link href="/admin/products" className="btn btn-secondary">Cancel</Link>
              <button type="submit" disabled={loading} className="btn btn-primary">
                {loading ? "Saving..." : "Save Product"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
