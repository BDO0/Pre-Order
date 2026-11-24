"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  buildVariantMatrix,
  buildVariantPayload,
  parseCapacityInput,
  variantKey,
  type VariantFormRow,
} from "@/lib/variant-plan";
import {
  compressImageClient,
  formatFileSize,
  type CompressionResult,
} from "@/lib/client-image-compression";
import { parseApiResponse } from "@/lib/api-client";
import ColorImageEditor from "@/components/ColorImageEditor";
import {
  VariantChipInput,
  mergeVariantTokens,
} from "@/components/VariantChipInput";
import {
  VariantAvailabilityMatrix,
  type AnnotatedVariantRow,
} from "@/components/VariantAvailabilityMatrix";
import {
  colorImagePayload,
  type ColorImageDraft,
} from "@/lib/product-color-images";

export default function NewProductPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [colorUploading, setColorUploading] = useState(false);
  const [error, setError] = useState("");
  const errorBannerRef = useRef<HTMLDivElement>(null);
  const [formData, setFormData] = useState({
    name: "",
    category: "",
    price: "",
    sizes: ["S", "M", "L", "XL"] as string[],
    colors: ["Black"] as string[],
    preorderLimit: "",
  });
  const [sizeDraft, setSizeDraft] = useState("");
  const [colorDraft, setColorDraft] = useState("");
  const [stock, setStock] = useState<Record<string, string>>({});
  const [disabledMap, setDisabledMap] = useState<Record<string, boolean>>({});
  const [fillValue, setFillValue] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [compressionInfo, setCompressionInfo] =
    useState<CompressionResult | null>(null);
  const compressionPreviewUrl = compressionInfo?.previewUrl;
  useEffect(() => {
    if (!compressionPreviewUrl) return;
    return () => URL.revokeObjectURL(compressionPreviewUrl);
  }, [compressionPreviewUrl]);
  const [compressing, setCompressing] = useState(false);
  const [colorImageDrafts, setColorImageDrafts] = useState<ColorImageDraft[]>(
    []
  );

  const reportError = (msg: string) => {
    setError(msg);
    setTimeout(() => {
      errorBannerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 30);
  };

  const effectiveSizes = useMemo(
    () =>
      sizeDraft.trim()
        ? mergeVariantTokens(formData.sizes, sizeDraft)
        : formData.sizes,
    [formData.sizes, sizeDraft]
  );
  const effectiveColors = useMemo(
    () =>
      colorDraft.trim()
        ? mergeVariantTokens(formData.colors, colorDraft)
        : formData.colors,
    [formData.colors, colorDraft]
  );

  const baseRows = useMemo(
    () => buildVariantMatrix(effectiveSizes, effectiveColors),
    [effectiveSizes, effectiveColors]
  );
  const rows: AnnotatedVariantRow[] = useMemo(
    () =>
      (baseRows.length > 0 ? baseRows : [{ size: null, color: null }]).map(
        (row) => {
          const key = variantKey(row.size, row.color);
          return {
            ...row,
            capacity: stock[key] ?? "",
            enabled: !disabledMap[key],
          };
        }
      ),
    [baseRows, stock, disabledMap]
  );
  const enabledRows = useMemo(() => rows.filter((r) => r.enabled), [rows]);

  const setStockFor = (row: VariantFormRow, value: string) => {
    const key = variantKey(row.size, row.color);
    setStock((previous) => ({ ...previous, [key]: value }));
  };

  const setBulkStock = (keys: string[], value: string) => {
    const parsed = parseCapacityInput(value);
    if (!parsed.ok) {
      reportError(parsed.message);
      return;
    }
    setError("");
    const trimmed = value.trim();
    setStock((prev) => {
      const next = { ...prev };
      for (const k of keys) next[k] = trimmed;
      return next;
    });
  };

  const toggleRowEnabled = (row: VariantFormRow) => {
    const key = variantKey(row.size, row.color);
    setDisabledMap((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const setRowsEnabled = (keys: string[], enabled: boolean) => {
    setDisabledMap((prev) => {
      const next = { ...prev };
      for (const k of keys) {
        if (enabled) delete next[k];
        else next[k] = true;
      }
      return next;
    });
  };

  const fillEveryBox = () => {
    const parsed = parseCapacityInput(fillValue);
    if (!parsed.ok) {
      reportError(parsed.message);
      return;
    }
    setError("");
    const next: Record<string, string> = {};
    for (const row of enabledRows) {
      next[variantKey(row.size, row.color)] = fillValue.trim();
    }
    setStock((previous) => ({ ...previous, ...next }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (colorUploading || compressing) {
      reportError("Please wait for image uploads to finish before saving.");
      return;
    }
    if (sizeDraft.trim() !== "" || colorDraft.trim() !== "") {
      setFormData((prev) => ({
        ...prev,
        sizes: effectiveSizes,
        colors: effectiveColors,
      }));
      setSizeDraft("");
      setColorDraft("");
    }
    setLoading(true);
    setError("");
    try {
      if (formData.name.trim().length < 2) {
        throw new Error("Product name is required (at least 2 characters).");
      }
      if (!formData.category.trim()) {
        throw new Error("Category is required (e.g. Tops, Bottoms).");
      }
      const numericPrice = Number(formData.price);
      if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
        throw new Error("Please enter a valid price greater than 0.");
      }
      if (enabledRows.length === 0) {
        throw new Error(
          "Enable at least one option so customers have something to choose."
        );
      }
      const payload = buildVariantPayload(enabledRows);
      if (!payload.ok) throw new Error(payload.message);
      const limit = parseCapacityInput(formData.preorderLimit);
      if (!limit.ok)
        throw new Error(`Total for this product: ${limit.message}`);
      let imageUrl = "";
      if (imageFile) {
        const uploadData = new FormData();
        uploadData.append("file", imageFile);
        uploadData.append("purpose", "PRODUCT_IMAGE");
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: uploadData,
        });
        const {
          ok: uploadOk,
          data: uploadJson,
          error: uploadErr,
        } = await parseApiResponse(uploadRes, "Failed to upload image.");
        if (!uploadOk || !uploadJson)
          throw new Error(uploadErr || "Failed to upload image.");
        imageUrl = uploadJson.url;
      }
      const slug = formData.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      const res = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          slug,
          category: formData.category.trim(),
          price: numericPrice,
          images: imageUrl ? [imageUrl] : [],
          active: true,
          preorderEnabled: true,
          preorderStatus: "OPEN",
          preorderLimit: limit.capacity,
          variants: payload.variants,
          colorImages: colorImagePayload(colorImageDrafts),
        }),
      });
      const { ok: createOk, error: createErr } = await parseApiResponse(
        res,
        "Failed to create product"
      );
      if (!createOk) throw new Error(createErr || "Failed to create product");
      router.push("/butigadmin/products");
      router.refresh();
    } catch (err: unknown) {
      reportError(
        err instanceof Error ? err.message : "Failed to create product"
      );
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: "var(--space-6)" }}>
        <Link
          href="/butigadmin/products"
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--color-neutral-500)",
            textDecoration: "none",
          }}
        >
          Back to Products
        </Link>
        <h1
          className="admin-page-title"
          style={{ marginTop: "var(--space-2)" }}
        >
          Add New Product
        </h1>
      </div>
      <div className="card" style={{ maxWidth: "760px" }}>
        <div className="card-body">
          <form
            noValidate
            onSubmit={handleSubmit}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            <div className="form-group">
              <label className="form-label form-label-required">
                Product Name
              </label>
              <input
                required
                type="text"
                className="form-input"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="e.g. TudungPeople Classic Shawl"
              />
            </div>
            <div style={{ display: "flex", gap: "var(--space-4)" }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label form-label-required">
                  Category
                </label>
                <input
                  required
                  type="text"
                  className="form-input"
                  value={formData.category}
                  onChange={(e) =>
                    setFormData({ ...formData, category: e.target.value })
                  }
                  placeholder="e.g. Tops"
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label form-label-required">
                  Base Price (₱)
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  className="form-input"
                  value={formData.price}
                  onChange={(e) =>
                    setFormData({ ...formData, price: e.target.value })
                  }
                  placeholder="500"
                />
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: "var(--space-4)",
                flexWrap: "wrap",
              }}
            >
              <VariantChipInput
                label="Sizes"
                placeholder="S, M, L, XL"
                hint="Type a size and press Enter, comma, or + Add."
                values={formData.sizes}
                onChange={(sizes) => setFormData({ ...formData, sizes })}
                onDraftChange={setSizeDraft}
                disabled={loading}
              />
              <VariantChipInput
                label="Colours"
                placeholder="Black, White"
                hint="Optional. Customize which sizes are available per colour below."
                values={formData.colors}
                onChange={(colors) => setFormData({ ...formData, colors })}
                onDraftChange={setColorDraft}
                disabled={loading}
              />
            </div>

            <VariantAvailabilityMatrix
              sizes={effectiveSizes}
              colors={effectiveColors}
              rows={rows}
              fillValue={fillValue}
              onFillValueChange={setFillValue}
              onFillEveryBox={fillEveryBox}
              onToggleRow={toggleRowEnabled}
              onSetRowsEnabled={setRowsEnabled}
              onSetStock={setStockFor}
              onSetBulkStock={setBulkStock}
            />

            <div className="form-group">
              <label className="form-label">Total for this product</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="form-input"
                value={formData.preorderLimit}
                onChange={(e) =>
                  setFormData({ ...formData, preorderLimit: e.target.value })
                }
                placeholder="no limit"
              />
              <span className="form-hint">
                A cap across every option together. Leave it empty for no limit.
                The boxes above are the ones that stop one size from selling out
                quietly.
              </span>
            </div>
            <div className="form-group">
              <label className="form-label">Product Image</label>
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) {
                    setImageFile(null);
                    setCompressionInfo(null);
                    return;
                  }
                  setCompressing(true);
                  try {
                    const result = await compressImageClient(file);
                    setImageFile(result.file);
                    setCompressionInfo(result);
                  } catch (err) {
                    console.error("Compression error:", err);
                    setImageFile(file);
                  } finally {
                    setCompressing(false);
                  }
                }}
                className="form-input"
                style={{ padding: "var(--space-2)" }}
                disabled={compressing || loading}
              />
              {compressing && (
                <span
                  className="form-hint"
                  style={{ color: "var(--color-info)" }}
                >
                  ⚡ Auto-compressing &amp; optimizing image clarity...
                </span>
              )}
              {compressionInfo && (
                <div
                  style={{
                    marginTop: "var(--space-3)",
                    display: "flex",
                    gap: "var(--space-3)",
                    alignItems: "center",
                    background: "var(--color-neutral-50)",
                    padding: "var(--space-3)",
                    borderRadius: "var(--radius-lg)",
                    border: "1px solid var(--color-neutral-200)",
                  }}
                >
                  <img
                    src={compressionInfo.previewUrl}
                    alt="Preview"
                    style={{
                      width: "56px",
                      height: "56px",
                      objectFit: "cover",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--color-neutral-300)",
                    }}
                  />
                  <div
                    style={{
                      fontSize: "var(--text-xs)",
                      color: "var(--color-neutral-700)",
                    }}
                  >
                    <span
                      style={{ fontWeight: 700, color: "var(--color-success)" }}
                    >
                      Auto-compressed for Storage
                    </span>
                    <br />
                    <span>
                      {formatFileSize(compressionInfo.originalBytes)} →{" "}
                      <strong>
                        {formatFileSize(compressionInfo.compressedBytes)}
                      </strong>
                    </span>{" "}
                    <span
                      style={{ color: "var(--color-success)", fontWeight: 700 }}
                    >
                      ({compressionInfo.savingsPercent}% saved)
                    </span>
                    <br />
                    <span style={{ color: "var(--color-neutral-500)" }}>
                      Resolution: {compressionInfo.width} ×{" "}
                      {compressionInfo.height} px (Full clarity preserved)
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Images per Colour</label>
              <span
                className="form-hint"
                style={{ display: "block", marginBottom: "var(--space-3)" }}
              >
                Optional. A colour with its own images replaces the main image
                the moment a shopper picks it. Colours left empty keep showing
                the product image above.
              </span>
              <ColorImageEditor
                colors={effectiveColors}
                drafts={colorImageDrafts}
                onChange={setColorImageDrafts}
                fallbackImageUrl={compressionInfo?.previewUrl}
                disabled={loading || compressing}
                onUploadingChange={setColorUploading}
              />
            </div>
            <div ref={errorBannerRef}>
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
                    fontSize: "var(--text-sm)",
                  }}
                >
                  {error}
                </div>
              )}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--space-4)",
                marginTop: "var(--space-4)",
              }}
            >
              <Link href="/butigadmin/products" className="btn btn-secondary">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={loading || compressing || colorUploading}
                className="btn btn-primary"
              >
                {loading
                  ? "Saving..."
                  : colorUploading || compressing
                  ? "Uploading images..."
                  : "Save Product"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
