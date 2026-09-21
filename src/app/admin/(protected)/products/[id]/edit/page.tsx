"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  buildVariantMatrix,
  buildVariantPayload,
  describeRetirements,
  describeVariant,
  parseCapacityInput,
  parseVariantList,
  variantKey,
  type StoredVariant,
  type VariantFormRow,
} from "@/lib/variant-plan";

/**
 * A variant of the product being edited, as the endpoint returns it.
 *
 * `capacity` and `remainingCapacity` are here because the stock box has to show
 * what is already claimed: `capacity - remainingCapacity` is the number of units
 * live orders hold, and a capacity below that is refused by the API. An operator
 * who cannot see that number types one that fails.
 */
interface ProductVariantDetail {
  id: string;
  size: string | null;
  color: string | null;
  capacity: number | null;
  remainingCapacity: number | null;
  active: boolean;
}

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
  preorderLimit: number | null;
  images: unknown;
  variants?: ProductVariantDetail[];
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
    colors: "",
    preorderLimit: "",
  });

  /**
   * What is typed into each stock box, keyed by option.
   *
   * Blank means "no limit". Seeded from the options the product actually has, so
   * saving an untouched form sends back the capacity it was already holding
   * instead of clearing it.
   */
  const [stock, setStock] = useState<Record<string, string>>({});
  const [fillValue, setFillValue] = useState("");

  /**
   * Every variant as stored, retired ones included.
   *
   * The grid is built from the active ones - showing a retired size as if it were
   * still on sale would un-retire it on the next save - but the plan needs the
   * retired ones as well, to tell "this option is coming back" apart from "this
   * option was never here".
   */
  const [storedVariants, setStoredVariants] = useState<StoredVariant[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const res = await fetch(`/api/admin/products/${id}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || "Failed to load product");

        const p = json.data as ProductDetail;
        const variants = p.variants ?? [];
        const onSale = variants.filter((variant) => variant.active);

        // Every colour on sale, not just the first one's. A product with Black and
        // White used to load with "Black" in the colour box, so saving the form
        // for any reason - renaming it, correcting the price - retired White, and
        // the screen said "Product updated successfully".
        const sizes = [...new Set(onSale.map((v) => v.size).filter((s): s is string => Boolean(s)))];
        const colors = [...new Set(onSale.map((v) => v.color).filter((c): c is string => Boolean(c)))];

        const seeded: Record<string, string> = {};
        for (const variant of onSale) {
          seeded[variantKey(variant.size, variant.color)] =
            variant.capacity === null ? "" : String(variant.capacity);
        }

        setFormData({
          name: p.name,
          category: p.category || "",
          price: String(p.price),
          preorderStatus: p.preorderStatus,
          active: p.active,
          sizes: sizes.join(", "),
          colors: colors.join(", "),
          preorderLimit: p.preorderLimit === null ? "" : String(p.preorderLimit),
        });
        setStock(seeded);
        setStoredVariants(
          variants.map((variant) => ({
            id: variant.id,
            size: variant.size,
            color: variant.color,
            capacity: variant.capacity,
            remainingCapacity: variant.remainingCapacity,
            active: variant.active,
          }))
        );
        setExistingImages(Array.isArray(p.images) ? (p.images as string[]) : []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load product");
      } finally {
        setFetching(false);
      }
    };
    fetchProduct();
  }, [id]);

  const rows: VariantFormRow[] = buildVariantMatrix(
    parseVariantList(formData.sizes),
    parseVariantList(formData.colors)
  ).map((row) => ({ ...row, capacity: stock[variantKey(row.size, row.color)] ?? "" }));

  // What the product is already holding, for the hint beside each box.
  const storedByKey = new Map(
    storedVariants
      .filter((variant) => variant.active)
      .map((variant) => [variantKey(variant.size, variant.color), variant])
  );

  const setStockFor = (row: VariantFormRow, value: string) => {
    const key = variantKey(row.size, row.color);
    setStock((previous) => ({ ...previous, [key]: value }));
  };

  /** One number for every option - "I can get 10 of each, whatever the size". */
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

  /**
   * "8 left of 30 - 22 already ordered" beside a stock box.
   *
   * The number the API refuses to go below, in the place where the mistake would
   * be made: a capacity under `ordered` comes back as an error, and an operator
   * with no way to see `ordered` can only guess.
   */
  const stockHint = (row: VariantFormRow): string => {
    const stored = storedByKey.get(variantKey(row.size, row.color));
    if (!stored || stored.capacity === null || stored.remainingCapacity === null) return "";

    const ordered = stored.capacity - stored.remainingCapacity;
    return ordered > 0
      ? `${stored.remainingCapacity} left of ${stored.capacity} — ${ordered} already ordered`
      : `${stored.capacity} available`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      // Saving with no options left would take the whole product off the
      // storefront, which is what the Disabled status is for. Saying so beats
      // letting a cleared field quietly empty a product.
      if (rows.length === 0) {
        throw new Error(
          "This would leave the product with nothing to choose, so nobody could order it. Add a size or a colour, or set the status to Disabled to take it off the storefront."
        );
      }

      const payload = buildVariantPayload(rows);
      if (!payload.ok) throw new Error(payload.message);

      const limit = parseCapacityInput(formData.preorderLimit);
      if (!limit.ok) throw new Error(`Total for this product: ${limit.message}`);

      // Say what is about to disappear, before it does. The list comes from the
      // same function the server runs, so it is what will actually happen rather
      // than a second opinion that can disagree with it.
      const retiring = describeRetirements(storedVariants, payload.variants);
      if (retiring.length > 0) {
        const confirmed = window.confirm(
          `Saving will take ${retiring.length} option${retiring.length === 1 ? "" : "s"} off the storefront:\n\n` +
            retiring.map((name) => `\u2022 ${name}`).join("\n") +
            "\n\nPast orders for them are untouched, and you can put them back by adding the size or colour again." +
            "\n\nSave anyway?"
        );
        if (!confirmed) {
          setLoading(false);
          return;
        }
      }

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

      const res = await fetch(`/api/admin/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          category: formData.category,
          price: Number(formData.price),
          active: formData.active,
          preorderStatus: formData.preorderStatus,
          preorderLimit: limit.capacity,
          images: finalImages,
          // Always sent, and now always non-empty: this screen refuses a save
          // that would leave a product with no options at all. The API still
          // honours an empty list, for requests that are not this form.
          variants: payload.variants,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to update product");

      // Say what happened to the options. "Product updated" was true but useless
      // when saving the form had just retired two of them.
      const changes = json.meta?.variantChanges as
        | { created: number; updated: number; retired: number }
        | null
        | undefined;
      const added = changes?.created ?? 0;
      const retired = changes?.retired ?? 0;

      const did: string[] = [];
      if (added > 0) did.push(`${added} new option${added === 1 ? "" : "s"} added`);
      if (retired > 0) did.push(`${retired} retired`);

      setSuccess(
        did.length > 0
          ? `Product updated. ${did.join(", ")}; past orders are untouched.`
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

            <div style={{ display: "flex", gap: "var(--space-4)" }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Sizes (comma separated)</label>
                <input type="text" className="form-input" value={formData.sizes}
                  onChange={e => setFormData({ ...formData, sizes: e.target.value })}
                  placeholder="S, M, L, XL" />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Colours (comma separated)</label>
                <input type="text" className="form-input" value={formData.colors}
                  onChange={e => setFormData({ ...formData, colors: e.target.value })}
                  placeholder="Black, White" />
                <span className="form-hint">Every colour is paired with every size.</span>
              </div>
            </div>

            {/* One row per size x colour, each with its own stock box. This replaces
                a single colour text field, which is why a product in two colours
                used to load showing only one of them. */}
            <div className="form-group">
              <label className="form-label">How many you can take</label>
              {rows.length === 0 ? (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-error)", margin: 0 }}>
                  ⚠ No options. Add a size or a colour, or a customer has nothing to choose.
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

                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                    {rows.map((row) => {
                      const hint = stockHint(row);
                      return (
                        <div key={variantKey(row.size, row.color)}>
                          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
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
                          {hint && (
                            <span className="form-hint" style={{ display: "block", marginTop: "2px" }}>{hint}</span>
                          )}
                        </div>
                      );
                    })}
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
