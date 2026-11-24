"use client";
import { useState, useEffect, useMemo, useRef, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  buildVariantMatrix,
  buildVariantPayload,
  describeRetirements,
  expandVariantPayload,
  parseCapacityInput,
  parseVariantList,
  variantKey,
  type StoredVariant,
  type VariantFormRow,
} from "@/lib/variant-plan";
import {
  compressImageClient,
  formatFileSize,
  heifUploadHint,
  type CompressionResult,
} from "@/lib/client-image-compression";
import { imageUrlAtWidth } from "@/lib/image-geometry";
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
  clearedColorLabels,
  colorImageDraftsFromRows,
  colorImagePayload,
  type ColorImageDraft,
  type StoredColorImageRow,
} from "@/lib/product-color-images";

interface ProductVariantDetail {
  id: string;
  size: string | null;
  color: string | null;
  capacity: number | null;
  remainingCapacity: number | null;
  active: boolean;
}
interface ProductDetail {
  name: string;
  category: string | null;
  price: string | number;
  preorderStatus: string;
  active: boolean;
  preorderLimit: number | null;
  preorderReserved?: number;
  images: unknown;
  colorImages?: StoredColorImageRow[];
  variants?: ProductVariantDetail[];
}

export default function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [colorUploading, setColorUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const errorBannerRef = useRef<HTMLDivElement>(null);
  const [formData, setFormData] = useState({
    name: "",
    category: "",
    price: "",
    preorderStatus: "OPEN",
    active: true,
    sizes: [] as string[],
    colors: [] as string[],
    preorderLimit: "",
  });
  const [sizeDraft, setSizeDraft] = useState("");
  const [colorDraft, setColorDraft] = useState("");
  const [preorderReserved, setPreorderReserved] = useState(0);
  const [isDirty, setIsDirty] = useState(false);

  const reportError = (msg: string) => {
    setError(msg);
    setTimeout(() => {
      errorBannerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 30);
  };

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const handleDelete = async () => {
    const confirmed = window.confirm(
      `Delete "${formData.name || "this product"}"?\n\nThis removes the product from your active Products list and Storefront and moves it to the Archive. Paid order records and analytics are preserved.`
    );
    if (!confirmed) return;

    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/products/${id}`, {
        method: "DELETE",
      });
      const { ok, data, error: apiErr } = await parseApiResponse(
        res,
        "Failed to delete product."
      );
      if (!ok) throw new Error(apiErr || "Failed to delete product.");

      const resData = data as {
        deleted?: boolean;
        message?: string;
      } | null;

      setSuccess(resData?.message || "Product deleted permanently.");
      setTimeout(() => router.push("/butigadmin/products"), 1200);
    } catch (err: unknown) {
      reportError(
        err instanceof Error ? err.message : "Failed to delete product."
      );
      setDeleting(false);
    }
  };

  const [stock, setStock] = useState<Record<string, string>>({});
  const [disabledMap, setDisabledMap] = useState<Record<string, boolean>>({});
  const [retireConfirmList, setRetireConfirmList] = useState<string[] | null>(
    null
  );
  const [fillValue, setFillValue] = useState("");
  const [storedVariants, setStoredVariants] = useState<StoredVariant[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [compressionInfo, setCompressionInfo] =
    useState<CompressionResult | null>(null);
  const [compressing, setCompressing] = useState(false);
  const compressionPreviewUrl = compressionInfo?.previewUrl;
  useEffect(() => {
    if (!compressionPreviewUrl) return;
    return () => URL.revokeObjectURL(compressionPreviewUrl);
  }, [compressionPreviewUrl]);
  const [colorImageDrafts, setColorImageDrafts] = useState<ColorImageDraft[]>(
    []
  );
  const [storedColorImages, setStoredColorImages] = useState<
    StoredColorImageRow[]
  >([]);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const res = await fetch(`/api/admin/products/${id}`);
        const {
          ok,
          data,
          error: apiErr,
        } = await parseApiResponse<ProductDetail>(
          res,
          "Failed to load product"
        );
        if (!ok || !data) throw new Error(apiErr || "Failed to load product");
        const p = data;
        const variants = p.variants ?? [];
        const onSale = variants.filter((variant) => variant.active);
        const expandedOnSale = expandVariantPayload(onSale);
        const sizes = [
          ...new Set(
            onSale.flatMap((v) => (v.size ? parseVariantList(v.size) : []))
          ),
        ];
        const colors = [
          ...new Set(
            onSale.flatMap((v) => (v.color ? parseVariantList(v.color) : []))
          ),
        ];
        const seeded: Record<string, string> = {};
        // Seed inactive variant capacities first so re-enabling a retired option
        // restores its previous capacity rather than starting blank.
        for (const variant of expandVariantPayload(variants)) {
          const key = variantKey(variant.size, variant.color);
          if (!(key in seeded) && variant.capacity !== null) {
            seeded[key] = String(variant.capacity);
          }
        }
        const activeKeys = new Set<string>();
        for (const variant of expandedOnSale) {
          const key = variantKey(variant.size, variant.color);
          activeKeys.add(key);
          seeded[key] =
            variant.capacity === null ? "" : String(variant.capacity);
        }
        const initialDisabled: Record<string, boolean> = {};
        for (const row of buildVariantMatrix(sizes, colors)) {
          const key = variantKey(row.size, row.color);
          if (!activeKeys.has(key)) {
            initialDisabled[key] = true;
          }
        }
        setFormData({
          name: p.name,
          category: p.category || "",
          price: String(p.price),
          preorderStatus: p.preorderStatus,
          active: p.active,
          sizes,
          colors,
          preorderLimit:
            p.preorderLimit === null ? "" : String(p.preorderLimit),
        });
        setPreorderReserved(p.preorderReserved ?? 0);
        setStock(seeded);
        setDisabledMap(initialDisabled);
        setIsDirty(false);
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
        setExistingImages(
          Array.isArray(p.images) ? (p.images as string[]) : []
        );
        const colorImages = p.colorImages ?? [];
        setStoredColorImages(colorImages);
        setColorImageDrafts(colorImageDraftsFromRows(colorImages));
      } catch (err: unknown) {
        reportError(
          err instanceof Error ? err.message : "Failed to load product"
        );
      } finally {
        setFetching(false);
      }
    };
    fetchProduct();
  }, [id]);

  // Include any un-blurred chip text so the matrix and save button always
  // reflect what the admin has typed on an iPad keyboard.
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

  const storedByKey = useMemo(
    () =>
      new Map(
        storedVariants
          .filter((variant) => variant.active)
          .map((variant) => [variantKey(variant.size, variant.color), variant])
      ),
    [storedVariants]
  );

  const baseRows = useMemo(
    () => buildVariantMatrix(effectiveSizes, effectiveColors),
    [effectiveSizes, effectiveColors]
  );

  const rows: AnnotatedVariantRow[] = useMemo(() => {
    const list =
      baseRows.length > 0 ? baseRows : [{ size: null, color: null }];
    return list.map((row) => {
      const key = variantKey(row.size, row.color);
      const stored = storedByKey.get(key);
      let hint = "";
      if (
        stored &&
        stored.capacity !== null &&
        stored.remainingCapacity !== null
      ) {
        const ordered = stored.capacity - stored.remainingCapacity;
        hint =
          ordered > 0
            ? `${stored.remainingCapacity} left of ${stored.capacity} — ${ordered} already ordered`
            : `${stored.capacity} available`;
      }
      return {
        ...row,
        capacity: stock[key] ?? "",
        enabled: !disabledMap[key],
        hint,
      };
    });
  }, [baseRows, stock, disabledMap, storedByKey]);

  const enabledRows = useMemo(() => rows.filter((r) => r.enabled), [rows]);

  const setStockFor = (row: VariantFormRow, value: string) => {
    const key = variantKey(row.size, row.color);
    setStock((previous) => ({ ...previous, [key]: value }));
    setIsDirty(true);
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
    setIsDirty(true);
  };

  const toggleRowEnabled = (row: VariantFormRow) => {
    const key = variantKey(row.size, row.color);
    setDisabledMap((prev) => ({ ...prev, [key]: !prev[key] }));
    setIsDirty(true);
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
    setIsDirty(true);
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
    setIsDirty(true);
  };

  const executeSave = async (skipRetireCheck = false) => {
    if (colorUploading || compressing) {
      reportError("Please wait for image uploads to finish before saving.");
      return;
    }
    // Commit any pending draft text from the chip inputs into formData state
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
    setSuccess("");
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
          "This would leave the product with nothing to choose, so nobody could order it. Enable at least one option, or set the status to Disabled to take it off the storefront."
        );
      }
      const payload = buildVariantPayload(enabledRows);
      if (!payload.ok) throw new Error(payload.message);
      const limit = parseCapacityInput(formData.preorderLimit);
      if (!limit.ok)
        throw new Error(`Total for this product: ${limit.message}`);
      if (limit.capacity !== null && limit.capacity < preorderReserved) {
        throw new Error(
          `Total for this product: Cannot set the limit to ${limit.capacity} because ${preorderReserved} unit(s) are already reserved.`
        );
      }
      if (!skipRetireCheck) {
        const retiring = describeRetirements(storedVariants, payload.variants);
        if (retiring.length > 0) {
          setRetireConfirmList(retiring);
          setLoading(false);
          return;
        }
      }
      let finalImages = existingImages;
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
          data: uploadDataRes,
          error: uploadErr,
        } = await parseApiResponse(uploadRes, "Failed to upload image.");
        if (!uploadOk || !uploadDataRes)
          throw new Error(uploadErr || "Failed to upload image.");
        finalImages = [uploadDataRes.url];
      }
      const res = await fetch(`/api/admin/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          category: formData.category.trim(),
          price: numericPrice,
          active: formData.active,
          preorderStatus: formData.preorderStatus,
          preorderLimit: limit.capacity,
          images: finalImages,
          variants: payload.variants,
          colorImages: colorImagePayload(colorImageDrafts),
          removeColorImages: clearedColorLabels(
            storedColorImages.map((row) => row.colorLabel || row.colorKey),
            colorImageDrafts
          ),
        }),
      });
      const {
        ok,
        data: updateData,
        error: updateErr,
      } = await parseApiResponse(res, "Failed to update product");
      if (!ok) throw new Error(updateErr || "Failed to update product");
      const changes = (
        updateData as {
          meta?: {
            variantChanges?: {
              created: number;
              updated: number;
              retired: number;
            };
          };
        } | null
      )?.meta?.variantChanges;
      const added = changes?.created ?? 0;
      const retired = changes?.retired ?? 0;
      const did: string[] = [];
      if (added > 0)
        did.push(`${added} new option${added === 1 ? "" : "s"} added`);
      if (retired > 0) did.push(`${retired} retired`);
      setRetireConfirmList(null);
      setIsDirty(false);
      setSuccess(
        did.length > 0
          ? `Product updated. ${did.join(", ")}; past orders are untouched.`
          : "Product updated successfully!"
      );
      setTimeout(() => router.push("/butigadmin/products"), 900);
    } catch (err: unknown) {
      reportError(
        err instanceof Error ? err.message : "Failed to update product"
      );
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-16)",
          color: "var(--color-neutral-500)",
        }}
      >
        Loading product...
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "var(--space-6)" }}>
        <Link
          href="/butigadmin/products"
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--color-brand-600)",
            textDecoration: "none",
            fontWeight: 500,
          }}
        >
          Back to Products
        </Link>
        <h1
          className="admin-page-title"
          style={{ marginTop: "var(--space-2)", marginBottom: 0 }}
        >
          Edit Product
        </h1>
      </div>
      {error && (
        <div
          style={{
            padding: "var(--space-3) var(--space-4)",
            background: "rgb(220 38 38 / 0.08)",
            border: "1px solid rgb(220 38 38 / 0.3)",
            borderRadius: "var(--radius-lg)",
            color: "var(--color-error)",
            marginBottom: "var(--space-4)",
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            padding: "var(--space-3) var(--space-4)",
            background: "rgb(22 163 74 / 0.08)",
            border: "1px solid rgb(22 163 74 / 0.3)",
            borderRadius: "var(--radius-lg)",
            color: "var(--color-success)",
            marginBottom: "var(--space-4)",
            fontWeight: 500,
          }}
        >
          {success}
        </div>
      )}
      <div className="card" style={{ maxWidth: "760px" }}>
        <div className="card-body">
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void executeSave(false);
            }}
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
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value });
                  setIsDirty(true);
                }}
              />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "var(--space-4)",
              }}
            >
              <div className="form-group">
                <label className="form-label form-label-required">
                  Category
                </label>
                <input
                  required
                  type="text"
                  className="form-input"
                  value={formData.category}
                  onChange={(e) => {
                    setFormData({ ...formData, category: e.target.value });
                    setIsDirty(true);
                  }}
                  placeholder="e.g. Tops, Bottoms"
                />
              </div>
              <div className="form-group">
                <label className="form-label form-label-required">
                  Price (₱)
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  className="form-input"
                  value={formData.price}
                  onChange={(e) => {
                    setFormData({ ...formData, price: e.target.value });
                    setIsDirty(true);
                  }}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label form-label-required">
                Pre-Order Status
              </label>
              <select
                required
                className="form-input"
                value={formData.preorderStatus}
                onChange={(e) => {
                  setFormData({ ...formData, preorderStatus: e.target.value });
                  setIsDirty(true);
                }}
              >
                <option value="OPEN">Open — Customers can order this</option>
                <option value="COMING_SOON">
                  Coming Soon — Visible but not orderable yet
                </option>
                <option value="SOLD_OUT">Sold Out — Show as unavailable</option>
                <option value="CLOSED">Closed</option>
                <option value="DISABLED">
                  Disabled — Hidden from customers
                </option>
              </select>
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
                onChange={(sizes) => {
                  setFormData({ ...formData, sizes });
                  setIsDirty(true);
                }}
                onDraftChange={setSizeDraft}
                disabled={loading || deleting}
              />
              <VariantChipInput
                label="Colours"
                placeholder="Black, White"
                hint="You can customize which sizes are available for each colour below."
                values={formData.colors}
                onChange={(colors) => {
                  setFormData({ ...formData, colors });
                  setIsDirty(true);
                }}
                onDraftChange={setColorDraft}
                disabled={loading || deleting}
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
                onChange={(e) => {
                  setFormData({ ...formData, preorderLimit: e.target.value });
                  setIsDirty(true);
                }}
                placeholder="no limit"
              />
              <span className="form-hint">
                {preorderReserved > 0
                  ? `${preorderReserved} unit${preorderReserved === 1 ? "" : "s"} already reserved across live orders. `
                  : ""}
                A cap across every option together. Leave it empty for no limit.
                The boxes above are the ones that stop one size from selling out
                quietly.
              </span>
            </div>
            <div className="form-group">
              <label className="form-label">Product Image</label>
              {existingImages[0] && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-3)",
                    marginBottom: "var(--space-2)",
                  }}
                >
                  <img
                    src={imageUrlAtWidth(existingImages[0], 400)}
                    alt={formData.name}
                    loading="lazy"
                    decoding="async"
                    style={{
                      width: "64px",
                      height: "64px",
                      objectFit: "cover",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--color-neutral-200)",
                    }}
                  />
                  <div>
                    <p
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--color-neutral-600)",
                        fontWeight: 500,
                        margin: 0,
                      }}
                    >
                      Current Image
                    </p>
                    <p
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--color-neutral-400)",
                        margin: 0,
                      }}
                    >
                      Select a file below to replace it.
                    </p>
                  </div>
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                className="form-input"
                disabled={compressing || loading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) {
                    setImageFile(null);
                    setCompressionInfo(null);
                    return;
                  }
                  setCompressing(true);
                  setIsDirty(true);
                  try {
                    const result = await compressImageClient(file);
                    setImageFile(result.file);
                    setCompressionInfo(result);
                  } catch (err) {
                    console.error("Compression error:", err);
                    const hint = heifUploadHint(file);
                    if (hint) {
                      reportError(hint);
                      setImageFile(null);
                      setCompressionInfo(null);
                      e.target.value = "";
                    } else {
                      setImageFile(file);
                    }
                  } finally {
                    setCompressing(false);
                  }
                }}
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
                    alt="New Preview"
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
              <span className="form-hint">
                Upload JPG, PNG or WebP to update product imagery.
                Auto-optimized for web.
              </span>
            </div>
            <div className="form-group">
              <label className="form-label">Images per Colour</label>
              <span
                className="form-hint"
                style={{ display: "block", marginBottom: "var(--space-2)" }}
              >
                Optional. A colour with its own images replaces the product
                image above the moment a shopper picks it. Colours left empty
                keep showing the main image.
              </span>
              <ColorImageEditor
                colors={effectiveColors}
                drafts={colorImageDrafts}
                onChange={(next) => {
                  setColorImageDrafts(next);
                  setIsDirty(true);
                }}
                fallbackImageUrl={
                  compressionInfo?.previewUrl || existingImages[0]
                }
                disabled={loading || compressing || deleting}
                onUploadingChange={setColorUploading}
              />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                padding: "var(--space-3) var(--space-4)",
                background: "var(--color-neutral-50)",
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--color-neutral-200)",
              }}
            >
              <input
                type="checkbox"
                id="active-toggle"
                checked={formData.active}
                onChange={(e) => {
                  setFormData({ ...formData, active: e.target.checked });
                  setIsDirty(true);
                }}
                style={{
                  width: "18px",
                  height: "18px",
                  accentColor: "var(--color-brand-500)",
                }}
              />
              <label
                htmlFor="active-toggle"
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "var(--color-neutral-700)",
                }}
              >
                Product is Active (visible to admin, available for batches)
              </label>
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
                gap: "var(--space-3)",
                marginTop: "var(--space-2)",
              }}
            >
              <Link
                href="/butigadmin/products"
                className="btn btn-secondary"
                style={{ flex: 1, justifyContent: "center" }}
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={loading || deleting || compressing || colorUploading}
                className="btn btn-primary"
                style={{ flex: 2 }}
              >
                {loading
                  ? "Saving..."
                  : colorUploading || compressing
                  ? "Uploading images..."
                  : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div
        className="card"
        style={{
          maxWidth: "760px",
          margin: "var(--space-6) 0 0",
          border: "1px solid rgb(220 38 38 / 0.2)",
          background: "rgb(254 242 242 / 0.35)",
        }}
      >
        <div className="card-body">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "var(--space-3)",
            }}
          >
            <div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: "var(--text-sm)",
                  color: "var(--color-error, #dc2626)",
                }}
              >
                Delete Product
              </div>
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-neutral-500)",
                  marginTop: "var(--space-1)",
                }}
              >
                Remove this product from your active Products list and move it to the Archive.
              </div>
            </div>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting || loading}
              className="btn btn-sm"
              style={{
                background: "var(--color-error, #dc2626)",
                color: "#ffffff",
                border: "none",
              }}
            >
              {deleting ? "Deleting..." : "Delete Product"}
            </button>
          </div>
        </div>
      </div>

      {retireConfirmList && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 350,
            background: "rgb(13 11 10 / 0.55)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--space-4)",
          }}
          onClick={() => setRetireConfirmList(null)}
        >
          <div
            className="card"
            style={{
              maxWidth: "460px",
              width: "100%",
              padding: "var(--space-6)",
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="retire-variants-title"
          >
            <h3
              id="retire-variants-title"
              style={{
                fontSize: "var(--text-lg)",
                fontWeight: 700,
                marginBottom: "var(--space-2)",
              }}
            >
              Take {retireConfirmList.length} option
              {retireConfirmList.length === 1 ? "" : "s"} off the storefront?
            </h3>
            <p
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--color-neutral-600)",
                marginBottom: "var(--space-3)",
              }}
            >
              Past orders for these options are untouched, and you can re-enable
              them anytime:
            </p>
            <ul
              style={{
                maxHeight: "180px",
                overflowY: "auto",
                marginBottom: "var(--space-4)",
                paddingLeft: "var(--space-5)",
                fontSize: "var(--text-sm)",
                color: "var(--color-neutral-800)",
              }}
            >
              {retireConfirmList.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--space-2)",
              }}
            >
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setRetireConfirmList(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={loading}
                onClick={() => {
                  setRetireConfirmList(null);
                  void executeSave(true);
                }}
              >
                {loading ? "Saving..." : "Save Anyway"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
