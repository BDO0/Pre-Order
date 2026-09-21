"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  buildVariantMatrix,
  buildVariantPayload,
  describeVariant,
  parseCapacityInput,
  parseVariantList,
  variantKey,
  type VariantFormRow,
} from "@/lib/variant-plan";

export default function NewProductPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    category: "",
    price: "",
    sizes: "S, M, L, XL",
    colors: "Black",
    // The cap for the whole product, on top of the per-option stock below.
    preorderLimit: "",
  });

  /**
   * What is typed into each stock box, keyed by option.
   *
   * Kept apart from the grid, which is derived from the two text boxes on every
   * render: typing "L" into the sizes box rebuilds the grid, and whatever was
   * already typed beside "M" has to survive that. An option that leaves the grid
   * keeps its entry, so a size deleted by accident brings its stock back with it.
   */
  const [stock, setStock] = useState<Record<string, string>>({});
  const [fillValue, setFillValue] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);

  const rows: VariantFormRow[] = buildVariantMatrix(
    parseVariantList(formData.sizes),
    parseVariantList(formData.colors)
  ).map((row) => ({ ...row, capacity: stock[variantKey(row.size, row.color)] ?? "" }));

  const setStockFor = (row: VariantFormRow, value: string) => {
    const key = variantKey(row.size, row.color);
    setStock((previous) => ({ ...previous, [key]: value }));
  };

  /** One number for every option - the common case of "I can get 10 of each". */
  const fillEveryBox = () => {
    const parsed = parseCapacityInput(fillValue);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }

    setError("");
    const next: Record<string, string> = {};
    for (const row of rows) {
      next[variantKey(row.size, row.color)] = fillValue.trim();
    }
    setStock((previous) => ({ ...previous, ...next }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // A product with no options is a product nobody can order: the storefront
      // would have nothing to choose and the cart nothing to add.
      if (rows.length === 0) {
        throw new Error(
          "Add at least one size or one colour. Without options there is nothing for a customer to choose."
        );
      }

      const payload = buildVariantPayload(rows);
      if (!payload.ok) throw new Error(payload.message);

      const limit = parseCapacityInput(formData.preorderLimit);
      if (!limit.ok) throw new Error(`Total for this product: ${limit.message}`);

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
          // Both halves of the limit: how many this option can take, and how many
          // the product can take overall. Blank is null, which the order service
          // reads as "no limit".
          preorderLimit: limit.capacity,
          variants: payload.variants,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to create product");

      router.push("/admin/products");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create product");
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

      <div className="card" style={{ maxWidth: "640px" }}>
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

            <div style={{ display: "flex", gap: "var(--space-4)" }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Sizes (comma separated)</label>
                <input type="text" className="form-input" value={formData.sizes} onChange={e => setFormData({ ...formData, sizes: e.target.value })} placeholder="S, M, L, XL" />
                <span className="form-hint">Customers pick one of these.</span>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Colours (comma separated)</label>
                <input type="text" className="form-input" value={formData.colors} onChange={e => setFormData({ ...formData, colors: e.target.value })} placeholder="Black, White" />
                <span className="form-hint">Optional. Each colour is paired with every size.</span>
              </div>
            </div>

            {/* One row per size x colour, each with its own stock box. This is the
                half the form was missing entirely: without it every product an
                operator created was unlimited, whatever the copy promised. */}
            <div className="form-group">
              <label className="form-label">How many you can take</label>
              {rows.length === 0 ? (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-error)", margin: 0 }}>
                  ⚠ Type at least one size or one colour above. A product with no options cannot be ordered.
                </p>
              ) : (
                <>
                  <span className="form-hint" style={{ display: "block", marginBottom: "var(--space-2)" }}>
                    {rows.length} option{rows.length === 1 ? "" : "s"}. Leave a box empty for no limit on that one.
                  </span>

                  <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", marginBottom: "var(--space-3)" }}>
                    <input
                      type="number"
                      min="1"
                      className="form-input"
                      style={{ maxWidth: "120px" }}
                      value={fillValue}
                      onChange={e => setFillValue(e.target.value)}
                      placeholder="e.g. 10"
                      aria-label="Stock to give every option"
                    />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={fillEveryBox}>
                      Give every option this many
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    {rows.map((row) => (
                      <div key={variantKey(row.size, row.color)} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                        <span style={{ flex: 1, fontSize: "var(--text-sm)", fontWeight: 500 }}>{describeVariant(row)}</span>
                        <input
                          type="number"
                          min="1"
                          className="form-input"
                          style={{ maxWidth: "130px" }}
                          value={row.capacity}
                          onChange={e => setStockFor(row, e.target.value)}
                          placeholder="no limit"
                          aria-label={`How many ${describeVariant(row)} you can take`}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Total for this product</label>
              <input
                type="number"
                min="1"
                className="form-input"
                value={formData.preorderLimit}
                onChange={e => setFormData({ ...formData, preorderLimit: e.target.value })}
                placeholder="no limit"
              />
              <span className="form-hint">
                A cap across every option together. Leave it empty for no limit. The boxes above are the ones that stop one size from selling out quietly.
              </span>
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
