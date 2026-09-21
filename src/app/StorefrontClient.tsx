"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/cart";
// The shop's own Instagram handle. This header used to spell the handle out as
// a literal, which quietly pinned the one piece of trust copy on the page to
// whatever the placeholder account was called: setting
// NEXT_PUBLIC_INSTAGRAM_HANDLE changed the other nine places it appears and not
// this one.
import { SHOP_INSTAGRAM_HANDLE } from "@/lib/site";
import styles from "./storefront.module.css";

export interface Variant {
  id: string;
  size: string | null;
  color: string | null;
  sku: string | null;
  priceOverride: number | null;
  capacity: number | null;
  remainingCapacity: number | null;
  active: boolean;
}

export interface StorefrontProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  category: string | null;
  description: string | null;
  images: string[];
  batchId: string;
  batchName: string;
  batchSlug: string;
  batchEndAt: string | null;
  preorderStatus: string;
  preorderRemaining: number | null;
  variants: Variant[];
}

interface Props {
  products: StorefrontProduct[];
  campaignTitle?: string;
  campaignDescription?: string | null;
  campaignEndAt?: string | null;
  campaignStatus?: string;
}

function getGarmentIcon(category?: string | null, name?: string) {
  const cat = (category || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (cat.includes("bottom") || n.includes("pant") || n.includes("cargo")) return "👖";
  if (cat.includes("outer") || n.includes("parka") || n.includes("jacket")) return "🧥";
  if (n.includes("sweatshirt") || n.includes("hoodie")) return "🥼";
  if (cat.includes("top") || n.includes("shirt") || n.includes("tee")) return "👕";
  if (n.includes("dress") || n.includes("skirt")) return "👗";
  return "🛍️";
}

export default function StorefrontClient({
  products,
  campaignTitle,
  campaignDescription,
  campaignEndAt,
  campaignStatus,
}: Props) {
  const { addItem, getItemCount } = useCartStore();
  const itemCount = getItemCount();

  // Selected product in left showcase
  const [selectedProductId, setSelectedProductId] = useState<string>(
    products[0]?.id ?? ""
  );

  // Active category filter on the right
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");

  // Highlighted product
  const activeProduct = useMemo(() => {
    return products.find((p) => p.id === selectedProductId) || products[0];
  }, [products, selectedProductId]);

  // Derived variants & options for active product
  const colors = useMemo(() => {
    if (!activeProduct?.variants) return [];
    return [...new Set(activeProduct.variants.filter((v) => v.color).map((v) => v.color!))];
  }, [activeProduct]);

  const sizes = useMemo(() => {
    if (!activeProduct?.variants) return [];
    return [...new Set(activeProduct.variants.filter((v) => v.size).map((v) => v.size!))];
  }, [activeProduct]);

  // Variant selections
  const [selectedColor, setSelectedColor] = useState<string | null>(colors[0] ?? null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  // When changing product, reset selection state
  const handleSelectProduct = (product: StorefrontProduct) => {
    setSelectedProductId(product.id);
    const newColors = [...new Set(product.variants.filter((v) => v.color).map((v) => v.color!))];
    setSelectedColor(newColors[0] ?? null);
    setSelectedSize(null);
    setQty(1);
    setAdded(false);
  };

  // Find exact matching variant
  const selectedVariant = useMemo(() => {
    if (!activeProduct || !activeProduct.variants || activeProduct.variants.length === 0) {
      return null;
    }
    const match = activeProduct.variants.find(
      (v) =>
        (selectedColor === null || v.color === selectedColor) &&
        (selectedSize === null || v.size === selectedSize)
    );
    return match || (colors.length === 0 && sizes.length === 0 ? activeProduct.variants[0] : null);
  }, [activeProduct, selectedColor, selectedSize, colors.length, sizes.length]);

  const isClosed =
    campaignStatus === "CLOSED" ||
    activeProduct?.preorderStatus === "CLOSED" ||
    activeProduct?.preorderStatus === "SOLD_OUT";

  const isOrderable =
    !isClosed &&
    activeProduct?.preorderStatus === "OPEN";

  const isVariantAvailable = (color: string | null, size: string | null) => {
    if (!activeProduct) return false;
    const v = activeProduct.variants.find(
      (variant) =>
        (color === null || variant.color === color) &&
        (size === null || variant.size === size)
    );
    if (!v || !v.active) return false;
    if (v.remainingCapacity !== null && v.remainingCapacity <= 0) return false;
    return true;
  };

  const effectivePrice = selectedVariant?.priceOverride
    ? Number(selectedVariant.priceOverride)
    : activeProduct
    ? Number(activeProduct.price)
    : 0;

  // Can add requires variant to be chosen (if product has sizes/colors) and sufficient capacity
  const canAdd =
    isOrderable &&
    selectedVariant &&
    selectedVariant.active &&
    (selectedVariant.remainingCapacity === null || selectedVariant.remainingCapacity >= qty);

  const handleAdd = () => {
    if (!activeProduct || !selectedVariant || !canAdd) return;

    addItem(
      {
        id: activeProduct.id,
        name: activeProduct.name,
        images: activeProduct.images,
        price: activeProduct.price,
      },
      selectedVariant,
      qty,
      activeProduct.batchId,
      activeProduct.batchSlug
    );

    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  // Categories list for filter tabs
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set);
  }, [products]);

  // Filtered right catalogue
  const filteredProducts = useMemo(() => {
    if (selectedCategory === "ALL") return products;
    return products.filter((p) => p.category === selectedCategory);
  }, [products, selectedCategory]);

  if (products.length === 0) {
    return (
      <div className="container" style={{ paddingBlock: "var(--space-16)" }}>
        <div className="empty-state">
          <div className="empty-state-icon">🛍️</div>
          <p className="empty-state-title">No Available Products</p>
          <p className="empty-state-text">
            There are currently no active pre-order items. Check back soon or visit our Instagram!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`container ${styles.storefrontWrap}`}>
      {/* Optional Campaign Drop Banner */}
      {campaignTitle && (
        <div className={styles.campaignHeader}>
          <div className={styles.campaignHeaderLeft}>
            <div className={styles.campaignBadgeRow}>
              <span className="badge badge-open">✨ Pre-Order Drop</span>
              {campaignEndAt && (
                <span className="badge badge-coming">
                  Closes {new Date(campaignEndAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <h1 className={styles.campaignTitle}>{campaignTitle}</h1>
            <p className={styles.campaignDesc}>
              {campaignDescription ||
                "Select any piece to customize sizing and color. All orders are confirmed personally with you on Instagram."}
            </p>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", fontWeight: 600 }}>
              DM: @{SHOP_INSTAGRAM_HANDLE}
            </span>
          </div>
        </div>
      )}

      {/* ── TWO-COLUMN SPLIT LAYOUT ── */}
      <div className={styles.splitLayout}>
        {/* ── LEFT COLUMN: Highlighted Product Showcase ── */}
        <div className={styles.highlightCol}>
          {activeProduct && (
            <div className={styles.showcaseCard}>
              <div className={styles.imageFrame}>
                {activeProduct.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={activeProduct.images[0]}
                    alt={activeProduct.name}
                    className={styles.showcaseImg}
                  />
                ) : (
                  <div className={styles.placeholderArt}>
                    <span className={styles.placeholderIcon}>
                      {getGarmentIcon(activeProduct.category, activeProduct.name)}
                    </span>
                    <span className={styles.placeholderLabel}>
                      {activeProduct.category || "ANA Collection"}
                    </span>
                  </div>
                )}

                <div className={styles.badgeOverlay}>
                  <span className={styles.viewingNowBadge}>
                    <span>★</span> Selected Item
                  </span>
                  {activeProduct.preorderStatus === "COMING_SOON" && (
                    <span className="badge badge-coming">Coming Soon</span>
                  )}
                  {activeProduct.preorderStatus === "SOLD_OUT" && (
                    <span className="badge badge-closed">Sold Out</span>
                  )}
                </div>
              </div>

              <div className={styles.showcaseBody}>
                <div className={styles.headerRow}>
                  <div>
                    <h2 className={styles.productName}>{activeProduct.name}</h2>
                    <div className={styles.metaRow}>
                      {activeProduct.category && (
                        <span className={styles.categoryPill}>{activeProduct.category}</span>
                      )}
                      <span>Drop: <strong>{activeProduct.batchName}</strong></span>
                    </div>
                  </div>
                  <div className={styles.priceTag}>
                    ₱{effectivePrice.toLocaleString()}
                  </div>
                </div>

                <p className={styles.descText}>
                  {activeProduct.description ||
                    "Limited-run crafted pre-order piece. Reserve yours before orders close."}
                </p>

                {/* Pre-order Controls */}
                {!isOrderable ? (
                  <div
                    style={{
                      padding: "var(--space-4)",
                      background: "var(--color-neutral-100)",
                      borderRadius: "var(--radius-lg)",
                      textAlign: "center",
                      fontWeight: 600,
                      color: "var(--color-neutral-600)",
                      fontSize: "var(--text-sm)",
                    }}
                  >
                    {activeProduct.preorderStatus === "COMING_SOON"
                      ? "✨ Coming soon to pre-order"
                      : "Item currently unavailable"}
                  </div>
                ) : (
                  <div className={styles.variantSection}>
                    {/* Color selection */}
                    {colors.length > 0 && (
                      <div>
                        <div className={styles.selectorLabel}>
                          <span>Color</span>
                          <span style={{ fontWeight: 500, color: "var(--color-neutral-800)" }}>
                            {selectedColor || "Select"}
                          </span>
                        </div>
                        <div className={styles.pillsRow} style={{ marginTop: "var(--space-1)" }}>
                          {colors.map((color) => (
                            <button
                              key={color}
                              type="button"
                              className={`${styles.optionPill} ${
                                selectedColor === color ? styles.selectedPill : ""
                              }`}
                              onClick={() => {
                                setSelectedColor(color);
                                setSelectedSize(null);
                              }}
                            >
                              {color}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Size selection */}
                    {sizes.length > 0 && (
                      <div>
                        <div className={styles.selectorLabel}>
                          <span>Size</span>
                          <span style={{ fontWeight: 500, color: "var(--color-neutral-800)" }}>
                            {selectedSize || "Select"}
                          </span>
                        </div>
                        <div className={styles.pillsRow} style={{ marginTop: "var(--space-1)" }}>
                          {sizes.map((size) => {
                            const available = isVariantAvailable(selectedColor, size);
                            return (
                              <button
                                key={size}
                                type="button"
                                className={`${styles.optionPill} ${
                                  selectedSize === size ? styles.selectedPill : ""
                                } ${!available ? styles.disabledPill : ""}`}
                                onClick={() => available && setSelectedSize(size)}
                                disabled={!available}
                              >
                                {size}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Quantity & CTA */}
                    <div className={styles.actionRow} style={{ marginTop: "var(--space-2)" }}>
                      <div className={styles.qtyBox}>
                        <button
                          type="button"
                          className={styles.qtyBtn}
                          onClick={() => setQty((q) => Math.max(1, q - 1))}
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <span className={styles.qtyVal}>{qty}</span>
                        <button
                          type="button"
                          className={styles.qtyBtn}
                          onClick={() => {
                            const max = selectedVariant?.remainingCapacity ?? 99;
                            setQty((q) => Math.min(max, q + 1));
                          }}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>

                      <button
                        type="button"
                        id="add-to-order-btn"
                        className={`${styles.addToOrderBtn} ${added ? styles.addedSuccessBtn : ""}`}
                        onClick={handleAdd}
                        disabled={!canAdd || added}
                      >
                        {added
                          ? "✓ Added to Order!"
                          : `Add to Pre-Order — ₱${(effectivePrice * qty).toLocaleString()}`}
                      </button>
                    </div>

                    {activeProduct.preorderRemaining !== null && (
                      <p
                        style={{
                          textAlign: "center",
                          fontSize: "var(--text-xs)",
                          color: "var(--color-brand-600)",
                          fontWeight: 600,
                          margin: 0,
                        }}
                      >
                        Only {activeProduct.preorderRemaining} slots left in this drop!
                      </p>
                    )}
                  </div>
                )}

                <div style={{ textAlign: "center" }}>
                  <Link
                    href={`/preorder/${activeProduct.slug}`}
                    className={styles.fullPageLink}
                  >
                    Open Standalone Page Details ↗
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN: Small Icon Product Catalogue Grid ── */}
        <div className={styles.catalogueCol}>
          <div className={styles.catalogueHeader}>
            <div>
              <h3 className={styles.catalogueTitle}>Collection Pieces</h3>
              <span className={styles.catalogueCount}>
                Click any product to view & customize on the left
              </span>
            </div>
            <span className="badge badge-open">
              {filteredProducts.length} item{filteredProducts.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Category Filter Pills */}
          {categories.length > 0 && (
            <div className={styles.filterPills}>
              <button
                type="button"
                className={`${styles.filterBtn} ${
                  selectedCategory === "ALL" ? styles.activeFilter : ""
                }`}
                onClick={() => setSelectedCategory("ALL")}
              >
                All ({products.length})
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`${styles.filterBtn} ${
                    selectedCategory === cat ? styles.activeFilter : ""
                  }`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat} ({products.filter((p) => p.category === cat).length})
                </button>
              ))}
            </div>
          )}

          {/* Compact Product Icon Grid */}
          <div className={styles.iconGrid}>
            {filteredProducts.map((p) => {
              const isSelected = p.id === activeProduct?.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  id={`product-card-${p.slug}`}
                  onClick={() => handleSelectProduct(p)}
                  className={`${styles.smallProductCard} ${
                    isSelected ? styles.activeProductCard : ""
                  }`}
                >
                  <div className={styles.smallThumbWrap}>
                    {p.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.images[0]} alt={p.name} className={styles.smallThumbImg} />
                    ) : (
                      <span className={styles.smallPlaceholder}>
                        {getGarmentIcon(p.category, p.name)}
                      </span>
                    )}
                    {isSelected && (
                      <span className={styles.activeChipBadge}>✓ Selected</span>
                    )}
                  </div>

                  <div className={styles.smallCardBody}>
                    <h4 className={styles.smallProductName}>{p.name}</h4>
                    <div className={styles.smallPriceRow}>
                      <span className={styles.smallProductPrice}>
                        ₱{p.price.toLocaleString()}
                      </span>
                      <span className={styles.smallStatusDot}>
                        {p.preorderStatus === "OPEN" ? "● Open" : p.preorderStatus}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Floating mobile Cart Button */}
      {itemCount > 0 && (
        <div className={styles.mobileFloatingCart}>
          <Link href="/cart" className="btn btn-primary btn-full btn-lg" style={{ boxShadow: "var(--shadow-xl)" }}>
            🛒 View Order ({itemCount} item{itemCount !== 1 ? "s" : ""}) →
          </Link>
        </div>
      )}
    </div>
  );
}
