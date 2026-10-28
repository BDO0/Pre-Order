"use client";

import { formatMoney } from "@/lib/format";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  getProductAvailabilityOverview,
  colorHexHint,
  DetailedVariant,
  buildProductListingSummary,
} from "@/lib/variant-stock";
import { parseApiResponse } from "@/lib/api-client";
import { buildColorImageMap, colorImageCoverage, primaryImageForColor } from "@/lib/product-color-images";
import { copyTextToClipboard } from "@/lib/clipboard";

interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  price: string | number;
  images: string[];
  colorImages?: { colorKey: string; url: string; sortOrder?: number | null }[];
  variants?: DetailedVariant[];
  active: boolean;
  preorderStatus: string;
}

type StockFilter = "ALL" | "ACTIVE_PO" | "IN_STOCK" | "LOW_OR_SOLD_OUT";

export default function AdminProductsPage() {
  const [products, setProducts] = useState<AdminProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedProductId, setCopiedProductId] = useState<string | null>(null);
  const [copiedSummaryId, setCopiedSummaryId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("ALL");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4500);
  };

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await fetch("/api/admin/products?limit=100");
        const { ok, data } = await parseApiResponse(res);
        if (ok && data) {
          setProducts(data.products);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, []);

  const handleDelete = async (product: AdminProductRow) => {
    const confirmed = window.confirm(
      `Permanently delete "${product.name}"?\n\nThis will remove the product, its variants, and any associated order records from the database. This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingId(product.id);
    try {
      const res = await fetch(`/api/admin/products/${product.id}`, {
        method: "DELETE",
      });
      const { ok, data, error } = await parseApiResponse(
        res,
        "Failed to delete the product"
      );
      if (!ok) throw new Error(error || "Failed to delete the product");

      const result = data as {
        deleted?: boolean;
        message?: string;
      } | null;

      showMsg(
        "success",
        result?.message || `"${product.name}" deleted permanently.`
      );
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      if (expandedProductId === product.id) {
        setExpandedProductId(null);
      }
    } catch (err) {
      showMsg(
        "error",
        err instanceof Error ? err.message : "Failed to delete the product"
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopySummary = async (
    product: AdminProductRow,
    overview: ReturnType<typeof getProductAvailabilityOverview>
  ) => {
    const text = buildProductListingSummary(
      product,
      overview,
      typeof window !== "undefined" ? window.location.origin : ""
    );
    const success = await copyTextToClipboard(text);
    if (success) {
      setCopiedSummaryId(product.id);
      showMsg("success", `Copied listing summary for "${product.name}" to clipboard!`);
      setTimeout(() => {
        setCopiedSummaryId((curr) => (curr === product.id ? null : curr));
      }, 2500);
    } else {
      showMsg("error", "Could not automatically copy summary to clipboard.");
    }
  };

  // Global catalog summary metrics
  const summaryMetrics = useMemo(() => {
    let totalVariants = 0;
    let totalRemainingUnits = 0;
    let totalCappedCapacity = 0;
    let lowStockCount = 0;
    let soldOutCount = 0;
    let activePOCount = 0;

    for (const p of products) {
      if (p.preorderStatus === "OPEN" && p.active) {
        activePOCount++;
      }
      const overview = getProductAvailabilityOverview(p.variants);
      totalVariants += overview.activeVariants;
      totalRemainingUnits += overview.totalRemaining;
      if (overview.totalCapacity !== null) {
        totalCappedCapacity += overview.totalCapacity;
      }
      if (overview.isSoldOut) {
        soldOutCount++;
      } else if (overview.isLowStock) {
        lowStockCount++;
      }
    }

    return {
      totalProducts: products.length,
      activePOCount,
      totalVariants,
      totalRemainingUnits,
      totalCappedCapacity,
      lowStockCount,
      soldOutCount,
    };
  }, [products]);

  // Filtered products list
  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return products.filter((product) => {
      // Stock/status filter
      const overview = getProductAvailabilityOverview(product.variants);
      if (filter === "ACTIVE_PO" && !(product.preorderStatus === "OPEN" && product.active)) {
        return false;
      }
      if (filter === "IN_STOCK" && (overview.isSoldOut || overview.activeVariants === 0)) {
        return false;
      }
      if (filter === "LOW_OR_SOLD_OUT" && !(overview.isSoldOut || overview.isLowStock)) {
        return false;
      }

      // Search query filter
      if (!q) return true;

      const nameMatch = product.name.toLowerCase().includes(q);
      const slugMatch = product.slug.toLowerCase().includes(q);
      const categoryMatch = product.category?.toLowerCase().includes(q) ?? false;

      const colorMatch = overview.colors.some((c) => c.name.toLowerCase().includes(q));
      const sizeMatch = overview.sizes.some((s) => s.name.toLowerCase().includes(q));

      return nameMatch || slugMatch || categoryMatch || colorMatch || sizeMatch;
    });
  }, [products, filter, searchQuery]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      {/* Page Title & Primary Action */}
      <div
        className="admin-page-title"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 0,
        }}
      >
        <div>
          <span>Products & Inventory Overview</span>
          <p
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--color-neutral-500)",
              marginTop: "4px",
              fontWeight: 400,
            }}
          >
            Monitor real-time color and size availability, stock caps, and customer order readiness.
          </p>
        </div>
        <Link href="/butigadmin/products/new" className="btn btn-primary">
          + New Product
        </Link>
      </div>

      {/* Alert Banner */}
      {message && (
        <div
          role={message.type === "error" ? "alert" : undefined}
          style={{
            padding: "var(--space-3) var(--space-4)",
            background:
              message.type === "success"
                ? "rgb(22 163 74 / 0.08)"
                : "rgb(220 38 38 / 0.08)",
            border: `1px solid ${
              message.type === "success"
                ? "rgb(22 163 74 / 0.3)"
                : "rgb(220 38 38 / 0.3)"
            }`,
            borderRadius: "var(--radius-lg)",
            color:
              message.type === "success"
                ? "var(--color-success)"
                : "var(--color-error)",
            fontWeight: 500,
          }}
        >
          {message.type === "success" ? "✓" : "⚠"} {message.text}
        </div>
      )}

      {/* Admin Summary Cards / Executive KPI Strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: "var(--space-4)",
        }}
      >
        {/* Total Products */}
        <div
          className="card"
          style={{
            padding: "var(--space-4)",
            background: "var(--color-bg-white)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--color-neutral-200)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>
            Total Products
          </div>
          <div style={{ fontSize: "var(--text-3xl)", fontWeight: 800, color: "var(--color-neutral-900)", marginTop: "4px" }}>
            {summaryMetrics.totalProducts}
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-600)", marginTop: "4px" }}>
            {products.filter((p) => p.active).length} active catalog items
          </div>
        </div>

        {/* Active Pre-Orders */}
        <div
          className="card"
          style={{
            padding: "var(--space-4)",
            background: "var(--color-bg-white)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--color-neutral-200)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>
            Open Pre-Orders
          </div>
          <div style={{ fontSize: "var(--text-3xl)", fontWeight: 800, color: "var(--color-brand-600)", marginTop: "4px" }}>
            {summaryMetrics.activePOCount}
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-success)", fontWeight: 600, marginTop: "4px" }}>
            Accepting customer orders
          </div>
        </div>

        {/* Total Color/Size Variants */}
        <div
          className="card"
          style={{
            padding: "var(--space-4)",
            background: "var(--color-bg-white)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--color-neutral-200)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>
            Color & Size Variants
          </div>
          <div style={{ fontSize: "var(--text-3xl)", fontWeight: 800, color: "var(--color-neutral-900)", marginTop: "4px" }}>
            {summaryMetrics.totalVariants}
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-600)", marginTop: "4px" }}>
            Live variant options across products
          </div>
        </div>

        {/* Stock Availability Health */}
        <div
          className="card"
          style={{
            padding: "var(--space-4)",
            background: "var(--color-bg-white)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--color-neutral-200)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>
            Inventory Health
          </div>
          <div style={{ fontSize: "var(--text-3xl)", fontWeight: 800, color: summaryMetrics.soldOutCount > 0 ? "var(--color-error)" : "var(--color-success)", marginTop: "4px" }}>
            {summaryMetrics.totalRemainingUnits}
            <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--color-neutral-500)", marginLeft: "4px" }}>
              units left
            </span>
          </div>
          <div style={{ fontSize: "var(--text-xs)", display: "flex", gap: "8px", marginTop: "4px" }}>
            {summaryMetrics.soldOutCount > 0 && (
              <span style={{ color: "var(--color-error)", fontWeight: 600 }}>
                {summaryMetrics.soldOutCount} sold out
              </span>
            )}
            {summaryMetrics.lowStockCount > 0 && (
              <span style={{ color: "var(--color-warning)", fontWeight: 600 }}>
                {summaryMetrics.lowStockCount} low stock
              </span>
            )}
            {summaryMetrics.soldOutCount === 0 && summaryMetrics.lowStockCount === 0 && (
              <span style={{ color: "var(--color-success)", fontWeight: 600 }}>
                All variants healthy
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--space-3)",
          background: "var(--color-bg-white)",
          padding: "var(--space-3) var(--space-4)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--color-neutral-200)",
        }}
      >
        {/* Filter Pills */}
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--color-neutral-500)", marginRight: "4px", textTransform: "uppercase" }}>
            Filter:
          </span>
          <button
            type="button"
            onClick={() => setFilter("ALL")}
            style={{
              padding: "4px 10px",
              borderRadius: "var(--radius-full)",
              border: "1px solid",
              borderColor: filter === "ALL" ? "var(--color-brand-600)" : "var(--color-neutral-200)",
              background: filter === "ALL" ? "var(--color-brand-50)" : "transparent",
              color: filter === "ALL" ? "var(--color-brand-700)" : "var(--color-neutral-700)",
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            All Products ({products.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("ACTIVE_PO")}
            style={{
              padding: "4px 10px",
              borderRadius: "var(--radius-full)",
              border: "1px solid",
              borderColor: filter === "ACTIVE_PO" ? "var(--color-brand-600)" : "var(--color-neutral-200)",
              background: filter === "ACTIVE_PO" ? "var(--color-brand-50)" : "transparent",
              color: filter === "ACTIVE_PO" ? "var(--color-brand-700)" : "var(--color-neutral-700)",
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Open Pre-Orders ({summaryMetrics.activePOCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter("IN_STOCK")}
            style={{
              padding: "4px 10px",
              borderRadius: "var(--radius-full)",
              border: "1px solid",
              borderColor: filter === "IN_STOCK" ? "var(--color-success)" : "var(--color-neutral-200)",
              background: filter === "IN_STOCK" ? "rgb(22 163 74 / 0.1)" : "transparent",
              color: filter === "IN_STOCK" ? "var(--color-success)" : "var(--color-neutral-700)",
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            In Stock
          </button>
          <button
            type="button"
            onClick={() => setFilter("LOW_OR_SOLD_OUT")}
            style={{
              padding: "4px 10px",
              borderRadius: "var(--radius-full)",
              border: "1px solid",
              borderColor: filter === "LOW_OR_SOLD_OUT" ? "var(--color-error)" : "var(--color-neutral-200)",
              background: filter === "LOW_OR_SOLD_OUT" ? "rgb(220 38 38 / 0.1)" : "transparent",
              color: filter === "LOW_OR_SOLD_OUT" ? "var(--color-error)" : "var(--color-neutral-700)",
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Needs Attention ({summaryMetrics.lowStockCount + summaryMetrics.soldOutCount})
          </button>
        </div>

        {/* Search input */}
        <div style={{ minWidth: "260px", position: "relative" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, color, or size..."
            style={{
              width: "100%",
              padding: "6px 12px",
              fontSize: "var(--text-xs)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-neutral-300)",
              outline: "none",
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute",
                right: "8px",
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--color-neutral-400)",
                fontSize: "12px",
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Main Products Table with Color & Size Availability Breakdown */}
      <div className="table-wrapper" style={{ background: "var(--color-bg-white)", borderRadius: "var(--radius-lg)", border: "1px solid var(--color-neutral-200)" }}>
        <div className="table-scroll">
          <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ width: "50px" }}>Image</th>
                <th style={{ minWidth: "140px" }}>Product Name</th>
                <th style={{ minWidth: "85px" }}>Price</th>
                <th style={{ minWidth: "140px", maxWidth: "180px" }}>Color Availability</th>
                <th style={{ minWidth: "120px", maxWidth: "160px" }}>Size Availability</th>
                <th style={{ minWidth: "115px", maxWidth: "140px" }}>Total Stock</th>
                <th style={{ minWidth: "110px" }}>Status</th>
                <th style={{ minWidth: "260px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "var(--space-8)" }}>
                    Loading product catalog...
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-neutral-500)" }}>
                    {products.length === 0 ? "No products found." : "No products match the selected filters or search query."}
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => {
                  const overview = getProductAvailabilityOverview(product.variants);
                  const isExpanded = expandedProductId === product.id;

                  return (
                    <ProductTableRow
                      key={product.id}
                      product={product}
                      overview={overview}
                      isExpanded={isExpanded}
                      copiedProductId={copiedProductId}
                      copiedSummaryId={copiedSummaryId}
                      deletingId={deletingId}
                      onToggleExpand={() =>
                        setExpandedProductId((prev) => (prev === product.id ? null : product.id))
                      }
                      onCopySummary={() => handleCopySummary(product, overview)}
                      onCopyLink={async () => {
                        const url = `${window.location.origin}/preorder/${product.slug}`;
                        const success = await copyTextToClipboard(url);
                        if (success) {
                          setCopiedProductId(product.id);
                          setTimeout(() => {
                            setCopiedProductId((curr) =>
                              curr === product.id ? null : curr
                            );
                          }, 2500);
                        }
                      }}
                      onDelete={() => handleDelete(product)}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ProductTableRow({
  product,
  overview,
  isExpanded,
  copiedProductId,
  copiedSummaryId,
  deletingId,
  onToggleExpand,
  onCopySummary,
  onCopyLink,
  onDelete,
}: {
  product: AdminProductRow;
  overview: ReturnType<typeof getProductAvailabilityOverview>;
  isExpanded: boolean;
  copiedProductId: string | null;
  copiedSummaryId: string | null;
  deletingId: string | null;
  onToggleExpand: () => void;
  onCopySummary: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
}) {
  const listingText = useMemo(() => {
    return buildProductListingSummary(
      product,
      overview,
      typeof window !== "undefined" ? window.location.origin : ""
    );
  }, [product, overview]);

  // How much of this product's colour range has its own photography. The chip in
  // the name cell only shows when the product actually offers colours.
  const colorImageMap = useMemo(
    () => buildColorImageMap(product.colorImages),
    [product.colorImages]
  );
  const galleryCoverage = useMemo(
    () => colorImageCoverage(product.variants, colorImageMap),
    [product.variants, colorImageMap]
  );
  // The same shot the storefront leads with: a product photographed only
  // colour-by-colour has an empty default gallery, and showing "IMG" for it
  // would tell an admin their images are missing when they are not.
  const thumbnail = useMemo(
    () => primaryImageForColor({ images: product.images, colorImages: colorImageMap }, null),
    [product.images, colorImageMap]
  );

  return (
    <>
      <tr style={{ background: isExpanded ? "var(--color-neutral-50)" : undefined }}>
        {/* Product Image */}
        <td style={{ width: "50px" }}>
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "var(--radius-sm)",
              background: "var(--color-neutral-100)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {thumbnail ? (
              <img
                src={thumbnail}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--color-neutral-400)" }}>
                IMG
              </span>
            )}
          </div>
        </td>

        {/* Product Name & Category */}
        <td>
          <div style={{ fontWeight: 700, color: "var(--color-neutral-900)" }}>{product.name}</div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "2px" }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
              {product.slug}
            </span>
            {product.category && (
              <span
                style={{
                  fontSize: "10px",
                  padding: "1px 6px",
                  background: "var(--color-neutral-100)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--color-neutral-600)",
                }}
              >
                {product.category}
              </span>
            )}
            {galleryCoverage.total > 0 && (
              <span
                title={
                  galleryCoverage.missing.length === 0
                    ? `All ${galleryCoverage.total} colours have their own photos`
                    : `Using the default gallery: ${galleryCoverage.missing.join(", ")}`
                }
                style={{
                  fontSize: "10px",
                  padding: "1px 6px",
                  borderRadius: "var(--radius-sm)",
                  whiteSpace: "nowrap",
                  background:
                    galleryCoverage.missing.length === 0
                      ? "rgb(22 163 74 / 0.08)"
                      : "rgb(217 119 6 / 0.08)",
                  color:
                    galleryCoverage.missing.length === 0
                      ? "var(--color-success)"
                      : "var(--color-warning)",
                  border: `1px solid ${
                    galleryCoverage.missing.length === 0
                      ? "rgb(22 163 74 / 0.2)"
                      : "rgb(217 119 6 / 0.2)"
                  }`,
                }}
              >
                Photos {galleryCoverage.covered}/{galleryCoverage.total}
              </span>
            )}
          </div>
        </td>

        {/* Base Price */}
        <td style={{ fontWeight: 600 }}>{formatMoney(Number(product.price))}</td>

        {/* Color Availability Breakdown */}
        <td style={{ maxWidth: "180px" }}>
          {overview.colors.length === 0 ? (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)" }}>—</span>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
              {overview.colors.map((c) => {
                const hex = colorHexHint(c.name);
                return (
                  <span
                    key={c.name}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "2px 7px",
                      borderRadius: "var(--radius-full)",
                      fontSize: "11px",
                      fontWeight: 600,
                      background: c.isSoldOut
                        ? "rgb(220 38 38 / 0.08)"
                        : c.isLowStock
                        ? "rgb(217 119 6 / 0.08)"
                        : "var(--color-neutral-100)",
                      color: c.isSoldOut
                        ? "var(--color-error)"
                        : c.isLowStock
                        ? "var(--color-warning)"
                        : "var(--color-neutral-800)",
                      border: `1px solid ${
                        c.isSoldOut
                          ? "rgb(220 38 38 / 0.2)"
                          : c.isLowStock
                          ? "rgb(217 119 6 / 0.2)"
                          : "var(--color-neutral-200)"
                      }`,
                    }}
                    title={`${c.name}: ${
                      c.isUnlimited
                        ? "Unlimited"
                        : c.isSoldOut
                        ? "Sold Out"
                        : `${c.remaining} remaining`
                    }`}
                  >
                    {hex && (
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: hex,
                          border: "1px solid rgba(0,0,0,0.15)",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span>{c.name}</span>
                    <span
                      style={{
                        opacity: 0.8,
                        fontSize: "10px",
                        fontWeight: 700,
                      }}
                    >
                      ({c.isUnlimited ? "∞" : c.isSoldOut ? "0" : c.remaining})
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </td>

        {/* Size Availability Breakdown */}
        <td style={{ maxWidth: "160px" }}>
          {overview.sizes.length === 0 ? (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)" }}>—</span>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
              {overview.sizes.map((s) => (
                <span
                  key={s.name}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "2px 6px",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "11px",
                    fontWeight: 600,
                    background: s.isSoldOut
                      ? "rgb(220 38 38 / 0.08)"
                      : s.isLowStock
                      ? "rgb(217 119 6 / 0.08)"
                      : "var(--color-neutral-100)",
                    color: s.isSoldOut
                      ? "var(--color-error)"
                      : s.isLowStock
                      ? "var(--color-warning)"
                      : "var(--color-neutral-800)",
                    border: `1px solid ${
                      s.isSoldOut
                        ? "rgb(220 38 38 / 0.2)"
                        : s.isLowStock
                        ? "rgb(217 119 6 / 0.2)"
                        : "var(--color-neutral-200)"
                    }`,
                  }}
                  title={`${s.name}: ${
                    s.isUnlimited
                      ? "Unlimited"
                      : s.isSoldOut
                      ? "Sold Out"
                      : `${s.remaining} left`
                  }`}
                >
                  <span>{s.name}</span>
                  <span style={{ opacity: 0.8, fontSize: "10px" }}>
                    ({s.isUnlimited ? "∞" : s.isSoldOut ? "0" : s.remaining})
                  </span>
                </span>
              ))}
            </div>
          )}
        </td>

        {/* Total Stock / Availability Status */}
        <td style={{ maxWidth: "140px" }}>
          <div style={{ fontWeight: 700, fontSize: "var(--text-xs)" }}>
            {overview.summaryText}
          </div>
          {overview.totalCapacity !== null && overview.totalCapacity > 0 && (
            <div
              style={{
                width: "90px",
                height: "5px",
                background: "var(--color-neutral-200)",
                borderRadius: "var(--radius-full)",
                overflow: "hidden",
                marginTop: "4px",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      Math.round((overview.totalRemaining / overview.totalCapacity) * 100)
                    )
                  )}%`,
                  background:
                    overview.isSoldOut
                      ? "var(--color-error)"
                      : overview.isLowStock
                      ? "var(--color-warning)"
                      : "var(--color-success)",
                }}
              />
            </div>
          )}
        </td>

        {/* Status */}
        <td>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <span className={`badge ${product.active ? "badge-open" : "badge-closed"}`}>
              {product.active ? "Active" : "Inactive"}
            </span>
            <span
              className={`badge ${
                product.preorderStatus === "OPEN"
                  ? "badge-open"
                  : product.preorderStatus === "COMING_SOON"
                  ? "badge-coming"
                  : product.preorderStatus === "SOLD_OUT"
                  ? "badge-sold-out"
                  : "badge-closed"
              }`}
            >
              PO {product.preorderStatus.replace("_", " ")}
            </span>
          </div>
        </td>

        {/* Actions */}
        <td>
          <div
            style={{
              display: "flex",
              gap: "var(--space-1)",
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            {/* View Color/Size matrix details */}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onToggleExpand}
              style={{
                fontWeight: isExpanded ? 700 : 500,
                color: isExpanded ? "var(--color-brand-600)" : undefined,
              }}
              title="View color and size breakdown"
            >
              {isExpanded ? "Hide Details ▲" : "Summary ▼"}
            </button>

            {/* Quick Copy summary text */}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={
                copiedSummaryId === product.id
                  ? {
                      color: "var(--color-success, #16a34a)",
                      fontWeight: 700,
                    }
                  : undefined
              }
              title="Copy product listing summary text (colors, sizes, stock, link)"
              onClick={onCopySummary}
            >
              {copiedSummaryId === product.id ? "Copied ✓" : "📋 Copy"}
            </button>

            {/* Customer Preview */}
            <Link
              href={`/preorder/${product.slug}`}
              target="_blank"
              className="btn btn-ghost btn-sm"
              title="View from customer POV"
            >
              Preview
            </Link>

            {/* Edit */}
            <Link
              href={`/butigadmin/products/${product.id}/edit`}
              className="btn btn-ghost btn-sm"
              title="Edit product & variants"
            >
              Edit
            </Link>

            {/* Copy customer link */}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={
                copiedProductId === product.id
                  ? {
                      color: "var(--color-success, #86efac)",
                      fontWeight: 700,
                    }
                  : undefined
              }
              title="Copy customer pre-order link"
              onClick={onCopyLink}
            >
              {copiedProductId === product.id ? "Link ✓" : "Link"}
            </button>

            {/* Delete button (hard delete) */}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: "var(--color-error, #dc2626)" }}
              disabled={deletingId === product.id}
              title="Permanently delete product"
              onClick={onDelete}
            >
              {deletingId === product.id ? "Deleting..." : "Delete"}
            </button>
          </div>
        </td>
      </tr>

      {/* Expandable Product Variant Matrix Drawer */}
      {isExpanded && (
        <tr style={{ background: "var(--color-neutral-50)" }}>
          <td colSpan={8} style={{ padding: "var(--space-4) var(--space-6)" }}>
            <div
              style={{
                maxWidth: "780px",
                boxSizing: "border-box",
                background: "var(--color-bg-white)",
                border: "1px solid var(--color-neutral-200)",
                borderRadius: "var(--radius-lg)",
                padding: "var(--space-4)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "var(--space-3)",
                  borderBottom: "1px solid var(--color-neutral-100)",
                  paddingBottom: "var(--space-3)",
                  marginBottom: "var(--space-3)",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <h4
                      style={{
                        margin: 0,
                        fontSize: "var(--text-sm)",
                        fontWeight: 700,
                        color: "var(--color-neutral-900)",
                      }}
                    >
                      Color & Size Inventory Matrix — {product.name}
                    </h4>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "1px 7px",
                        borderRadius: "var(--radius-full)",
                        background: overview.isSoldOut
                          ? "rgb(220 38 38 / 0.12)"
                          : overview.isLowStock
                          ? "rgb(217 119 6 / 0.12)"
                          : "rgb(22 163 74 / 0.12)",
                        color: overview.isSoldOut
                          ? "var(--color-error)"
                          : overview.isLowStock
                          ? "var(--color-warning)"
                          : "var(--color-success)",
                      }}
                    >
                      {overview.summaryText}
                    </span>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "var(--text-xs)",
                      color: "var(--color-neutral-500)",
                      marginTop: "3px",
                    }}
                  >
                    Compact overview of variant options, remaining availability, and pre-order readiness.
                  </p>
                </div>

                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{
                      fontSize: "12px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                    title="Copy complete product summary for easy listing on social media"
                    onClick={onCopySummary}
                  >
                    {copiedSummaryId === product.id ? "✓ Copied Summary!" : "📋 Copy Summary Text"}
                  </button>

                  <Link
                    href={`/butigadmin/products/${product.id}/edit`}
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: "11px" }}
                  >
                    Adjust Stock in Editor →
                  </Link>
                </div>
              </div>

              {/* Ready-to-Post Listing Summary Preview / Quick Copy */}
              <div
                style={{
                  background: "var(--color-neutral-50)",
                  border: "1px solid var(--color-neutral-200)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-3)",
                  marginBottom: "var(--space-3)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "6px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "var(--color-neutral-700)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    📋 Ready-to-Post Listing Summary
                  </span>
                  <button
                    type="button"
                    onClick={onCopySummary}
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "2px 8px",
                      background: copiedSummaryId === product.id ? "var(--color-success)" : "var(--color-bg-white)",
                      color: copiedSummaryId === product.id ? "#fff" : "var(--color-brand-700)",
                      border: "1px solid var(--color-neutral-300)",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                    }}
                  >
                    {copiedSummaryId === product.id ? "✓ Copied!" : "Copy Text"}
                  </button>
                </div>
                <pre
                  style={{
                    margin: 0,
                    fontFamily: "inherit",
                    fontSize: "11px",
                    color: "var(--color-neutral-600)",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.45,
                    maxHeight: "110px",
                    overflowY: "auto",
                    background: "var(--color-bg-white)",
                    padding: "8px 10px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--color-neutral-200)",
                  }}
                >
                  {listingText}
                </pre>
              </div>

              {(!product.variants || product.variants.length === 0) ? (
                <div style={{ padding: "var(--space-4)", textAlign: "center", color: "var(--color-neutral-500)", fontSize: "var(--text-xs)" }}>
                  No variant combinations configured for this product.
                </div>
              ) : (
                <table
                  style={{
                    width: "100%",
                    fontSize: "var(--text-xs)",
                    borderCollapse: "collapse",
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--color-neutral-200)", color: "var(--color-neutral-500)", textAlign: "left" }}>
                      <th style={{ padding: "6px 8px" }}>Color</th>
                      <th style={{ padding: "6px 8px" }}>Size</th>
                      <th style={{ padding: "6px 8px" }}>SKU</th>
                      <th style={{ padding: "6px 8px" }}>Remaining / Capacity</th>
                      <th style={{ padding: "6px 8px" }}>Units Ordered</th>
                      <th style={{ padding: "6px 8px" }}>Availability Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.variants.map((v) => {
                      const hex = colorHexHint(v.color);
                      const isUncapped = v.capacity === null;
                      const cap = v.capacity ?? 0;
                      const rem = v.remainingCapacity ?? 0;
                      const ordered = isUncapped ? "—" : Math.max(0, cap - rem);
                      const isSoldOut = !isUncapped && rem === 0;
                      const isLowStock = !isUncapped && rem > 0 && rem <= 3;
                      const isActive = v.active !== false;

                      return (
                        <tr
                          key={v.id || `${v.color}-${v.size}`}
                          style={{
                            borderBottom: "1px solid var(--color-neutral-100)",
                            opacity: isActive ? 1 : 0.5,
                          }}
                        >
                          {/* Color */}
                          <td style={{ padding: "6px 8px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              {hex && (
                                <span
                                  style={{
                                    width: "10px",
                                    height: "10px",
                                    borderRadius: "50%",
                                    background: hex,
                                    border: "1px solid rgba(0,0,0,0.2)",
                                  }}
                                />
                              )}
                              <span style={{ fontWeight: 600 }}>{v.color || "Standard / None"}</span>
                            </div>
                          </td>

                          {/* Size */}
                          <td style={{ padding: "6px 8px" }}>
                            <span
                              style={{
                                padding: "2px 6px",
                                background: "var(--color-neutral-100)",
                                borderRadius: "var(--radius-sm)",
                                fontWeight: 700,
                              }}
                            >
                              {v.size || "One Size"}
                            </span>
                          </td>

                          {/* SKU */}
                          <td style={{ padding: "6px 8px", color: "var(--color-neutral-500)" }}>
                            {v.sku || "—"}
                          </td>

                          {/* Stock allocation */}
                          <td style={{ padding: "6px 8px" }}>
                            {isUncapped ? (
                              <span style={{ color: "var(--color-neutral-700)", fontWeight: 600 }}>
                                Unlimited
                              </span>
                            ) : (
                              <span style={{ fontWeight: 700 }}>
                                {rem} <span style={{ color: "var(--color-neutral-400)", fontWeight: 400 }}>of</span> {cap}
                              </span>
                            )}
                          </td>

                          {/* Units ordered */}
                          <td style={{ padding: "6px 8px", color: "var(--color-neutral-600)" }}>
                            {ordered}
                          </td>

                          {/* Availability status badge */}
                          <td style={{ padding: "6px 8px" }}>
                            {!isActive ? (
                              <span
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: "var(--radius-sm)",
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  background: "var(--color-neutral-200)",
                                  color: "var(--color-neutral-600)",
                                }}
                              >
                                Inactive
                              </span>
                            ) : isSoldOut ? (
                              <span
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: "var(--radius-sm)",
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  background: "rgb(220 38 38 / 0.12)",
                                  color: "var(--color-error)",
                                }}
                              >
                                Sold Out
                              </span>
                            ) : isLowStock ? (
                              <span
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: "var(--radius-sm)",
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  background: "rgb(217 119 6 / 0.12)",
                                  color: "var(--color-warning)",
                                }}
                              >
                                Low Stock ({rem} left)
                              </span>
                            ) : isUncapped ? (
                              <span
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: "var(--radius-sm)",
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  background: "rgb(37 99 235 / 0.1)",
                                  color: "var(--color-info)",
                                }}
                              >
                                Unlimited
                              </span>
                            ) : (
                              <span
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: "var(--radius-sm)",
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  background: "rgb(22 163 74 / 0.12)",
                                  color: "var(--color-success)",
                                }}
                              >
                                Available ({rem} in stock)
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
