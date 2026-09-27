"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/cart";
import { SHOP_INSTAGRAM_HANDLE, SHOP_INSTAGRAM_URL, SITE_NAME } from "@/lib/site";
import { CustomBagIcon, CustomHangerIcon, GarmentSilhouette } from "@/components/CustomerIcons";
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
  campaignStatus?: string;
}
export default function StorefrontClient({
  products,
  campaignStatus,
}: Props) {
  const { addItem, getItemCount } = useCartStore();
  const [mounted, setMounted] = useState(false);
  const showcaseRef = useRef<HTMLDivElement>(null);
  const [highlightPulse, setHighlightPulse] = useState(false);
  const [showAllCatalogue, setShowAllCatalogue] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const itemCount = mounted ? getItemCount() : 0;
  const [selectedProductId, setSelectedProductId] = useState<string>(
    products[0]?.id ?? ""
  );
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const activeProduct = useMemo(() => {
    return products.find((p) => p.id === selectedProductId) || products[0];
  }, [products, selectedProductId]);
  const colors = useMemo(() => {
    if (!activeProduct?.variants) return [];
    return [...new Set(activeProduct.variants.filter((v) => v.color).map((v) => v.color!))];
  }, [activeProduct]);
  const sizes = useMemo(() => {
    if (!activeProduct?.variants) return [];
    return [...new Set(activeProduct.variants.filter((v) => v.size).map((v) => v.size!))];
  }, [activeProduct]);
  const [selectedColor, setSelectedColor] = useState<string | null>(colors[0] ?? null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [imgZoom, setImgZoom] = useState(1);
  const [imgFit, setImgFit] = useState<"cover" | "contain">("cover");
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 3;
  const ZOOM_STEP = 0.25;

  const handleSelectProduct = (product: StorefrontProduct, autoScroll = true) => {
    setSelectedProductId(product.id);
    const newColors = [...new Set(product.variants.filter((v) => v.color).map((v) => v.color!))];
    setSelectedColor(newColors[0] ?? null);
    setSelectedSize(null);
    setQty(1);
    setAdded(false);
    setImgZoom(1);
    setImgFit("cover");
    setHighlightPulse(true);
    setTimeout(() => setHighlightPulse(false), 800);
    if (autoScroll && typeof window !== "undefined" && window.innerWidth <= 960) {
      showcaseRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  const selectedVariant = useMemo(() => {
    if (!activeProduct || !activeProduct.variants || activeProduct.variants.length === 0) {
      return null;
    }
    if (sizes.length > 0 && !selectedSize) {
      return null;
    }
    if (colors.length > 0 && !selectedColor) {
      return null;
    }
    const match = activeProduct.variants.find(
      (v) =>
        (colors.length === 0 || v.color === selectedColor) &&
        (sizes.length === 0 || v.size === selectedSize)
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
        (colors.length === 0 || variant.color === color) &&
        (sizes.length === 0 || variant.size === size)
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
  const canAdd =
    isOrderable &&
    Boolean(selectedVariant) &&
    Boolean(selectedVariant?.active) &&
    (selectedVariant?.remainingCapacity === null || (selectedVariant?.remainingCapacity ?? 0) >= qty);
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
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set);
  }, [products]);
  const filteredProducts = useMemo(() => {
    if (selectedCategory === "ALL") return products;
    return products.filter((p) => p.category === selectedCategory);
  }, [products, selectedCategory]);
  const currentIndex = useMemo(() => {
    return filteredProducts.findIndex((p) => p.id === activeProduct?.id);
  }, [filteredProducts, activeProduct]);
  const handlePrevProduct = () => {
    if (filteredProducts.length <= 1) return;
    const prevIndex = (currentIndex - 1 + filteredProducts.length) % filteredProducts.length;
    handleSelectProduct(filteredProducts[prevIndex], false);
  };
  const handleNextProduct = () => {
    if (filteredProducts.length <= 1) return;
    const nextIndex = (currentIndex + 1) % filteredProducts.length;
    handleSelectProduct(filteredProducts[nextIndex], false);
  };
  if (products.length === 0) {
    return (
      <div className="glass-storefront" style={{ paddingBlock: "var(--space-16)", maxWidth: "var(--max-w-xl)", marginInline: "auto", paddingInline: "var(--space-6)" }}>
        <div
          style={{
            background: "rgba(255, 255, 255, 0.08)",
            backdropFilter: "blur(32px) saturate(200%)",
            WebkitBackdropFilter: "blur(32px) saturate(200%)",
            borderRadius: "var(--radius-2xl)",
            border: "1px solid rgba(255, 255, 255, 0.16)",
            padding: "var(--space-12) var(--space-8)",
            textAlign: "center",
            boxShadow:
              "0 24px 64px rgba(0, 0, 0, 0.65), 0 0 36px rgba(255, 175, 200, 0.2), 0 0 64px rgba(156, 232, 248, 0.12), inset 0 1.5px 1px 0 rgba(255, 255, 255, 0.55), inset 0 -1px 1px 0 rgba(255, 255, 255, 0.1)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-3)",
          }}
        >
          <div className={styles.emptyStateIcon} aria-hidden="true">
            <CustomHangerIcon size={38} />
          </div>
          <h2
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(1.75rem, 3.5vw, 2.25rem)",
              fontWeight: 700,
              background: "linear-gradient(135deg, #ffffff 0%, #ffeaf0 50%, #f7b4c4 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            New Drop Coming Soon
          </h2>
          <p style={{ color: "rgba(255, 255, 255, 0.85)", fontSize: "var(--text-base)", maxWidth: "420px", lineHeight: 1.6, margin: 0 }}>
            There are currently no active pre-order items. Follow our Instagram to catch the next exclusive drop.
          </p>
          <a
            href={SHOP_INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary btn-lg"
            style={{
              marginTop: "var(--space-4)",
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            Follow @{SHOP_INSTAGRAM_HANDLE}
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className={`glass-storefront ${styles.storefrontWrap}`}>
      <div className={styles.splitLayout}>
        <div className={styles.highlightCol}>
          {activeProduct && (
            <div
              ref={showcaseRef}
              className={`${styles.showcaseCard} ${highlightPulse ? styles.showcasePulse : ""}`}
            >
              <div className={styles.imageFrame}>
                {filteredProducts.length > 1 && (
                  <>
                    <button
                      type="button"
                      className={styles.showcaseNavBtnLeft}
                      onClick={handlePrevProduct}
                      aria-label="Previous piece"
                      title="Previous piece"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block", transform: "translateX(-1px)" }}>
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={styles.showcaseNavBtnRight}
                      onClick={handleNextProduct}
                      aria-label="Next piece"
                      title="Next piece"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block", transform: "translateX(1px)" }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </>
                )}
                {activeProduct.images[0] ? (
                  <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
                    <img
                      src={activeProduct.images[0]}
                      alt={activeProduct.name}
                      className={styles.showcaseImg}
                      style={{
                        transform: `scale(${imgZoom})`,
                        transformOrigin: "center center",
                        transition: "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                        objectFit: imgFit,
                      }}
                    />
                    {activeProduct.images[0] && (
                      <div style={{
                        position: "absolute",
                        bottom: "var(--space-3)",
                        right: "var(--space-3)",
                        display: "flex",
                        gap: "6px",
                        zIndex: 10,
                      }}>
                        <button
                          type="button"
                          onClick={() => {
                            if (imgFit === "cover") {
                              // First zoom-out: switch to contain at scale 1 (full image, touching edges)
                              setImgFit("contain");
                            } else {
                              // Already in contain mode: scale down
                              setImgZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)));
                            }
                          }}
                          disabled={imgFit === "contain" && imgZoom <= MIN_ZOOM}
                          aria-label="Zoom out"
                          style={{
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                            border: "1px solid rgba(255,255,255,0.3)",
                            background: "rgba(20, 2, 7, 0.75)",
                            backdropFilter: "blur(12px)",
                            color: "white",
                            fontSize: "18px",
                            fontWeight: 700,
                            lineHeight: 1,
                            cursor: (imgFit === "contain" && imgZoom <= MIN_ZOOM) ? "not-allowed" : "pointer",
                            opacity: (imgFit === "contain" && imgZoom <= MIN_ZOOM) ? 0.35 : 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "opacity 0.2s",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                          }}
                        >−</button>
                        <button
                          type="button"
                          onClick={() => {
                            if (imgFit === "contain" && imgZoom <= 1) {
                              // Going back to cover from the first zoom-out step
                              setImgFit("cover");
                              setImgZoom(1);
                            } else if (imgFit === "contain") {
                              setImgZoom((z) => Math.min(1, +(z + ZOOM_STEP).toFixed(2)));
                            } else {
                              setImgZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)));
                            }
                          }}
                          disabled={imgFit === "cover" && imgZoom >= MAX_ZOOM}
                          aria-label="Zoom in"
                          style={{
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                            border: "1px solid rgba(255,255,255,0.3)",
                            background: "rgba(20, 2, 7, 0.75)",
                            backdropFilter: "blur(12px)",
                            color: "white",
                            fontSize: "18px",
                            fontWeight: 700,
                            lineHeight: 1,
                            cursor: (imgFit === "cover" && imgZoom >= MAX_ZOOM) ? "not-allowed" : "pointer",
                            opacity: (imgFit === "cover" && imgZoom >= MAX_ZOOM) ? 0.35 : 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "opacity 0.2s",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                          }}
                        >+</button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className={styles.placeholderArt}>
                    <div className={styles.placeholderIconWrap}>
                      <GarmentSilhouette
                        category={activeProduct.category}
                        name={activeProduct.name}
                        size={48}
                      />
                    </div>
                    <span className={styles.placeholderLabel}>
                      {activeProduct.category || `${SITE_NAME} Collection`}
                    </span>
                  </div>
                )}
                {(activeProduct.preorderStatus === "COMING_SOON" || activeProduct.preorderStatus === "SOLD_OUT") && (
                  <div className={styles.badgeOverlay}>
                    {activeProduct.preorderStatus === "COMING_SOON" && (
                      <span className="badge badge-coming">Coming Soon</span>
                    )}
                    {activeProduct.preorderStatus === "SOLD_OUT" && (
                      <span className="badge badge-closed">Sold Out</span>
                    )}
                  </div>
                )}
              </div>
              <div className={styles.showcaseBody}>
                <div className={styles.headerRow}>
                  <div>
                    <h2 className={styles.productName}>{activeProduct.name}</h2>
                    {activeProduct.category && (
                      <div className={styles.metaRow}>
                        <span className={styles.categoryPill}>{activeProduct.category}</span>
                      </div>
                    )}
                  </div>
                  <div className={styles.priceTag}>
                    ₱{effectivePrice.toLocaleString()}
                  </div>
                </div>
                <p className={styles.descText}>
                  {activeProduct.description ||
                    "Limited-run crafted pre-order piece. Reserve yours before orders close."}
                </p>
                {!isOrderable ? (
                  <div
                    style={{
                      padding: "var(--space-4)",
                      background: "rgba(255, 255, 255, 0.08)",
                      border: "1px solid rgba(255, 255, 255, 0.16)",
                      borderRadius: "var(--radius-lg)",
                      textAlign: "center",
                      fontWeight: 600,
                      color: "rgba(255, 255, 255, 0.85)",
                      fontSize: "var(--text-sm)",
                    }}
                  >
                    {activeProduct.preorderStatus === "COMING_SOON"
                      ? "Coming soon to pre-order"
                      : "Item currently unavailable"}
                  </div>
                ) : (
                  <div className={styles.variantSection}>
                    {colors.length > 0 && (
                      <div>
                        <div className={styles.selectorLabel}>
                          <span>Color</span>
                          <span style={{ fontWeight: 600, color: "rgba(255, 255, 255, 0.95)" }}>
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
                    {sizes.length > 0 && (
                      <div>
                        <div className={styles.selectorLabel}>
                          <span>Size</span>
                          <span style={{ fontWeight: 600, color: selectedSize ? "rgba(255, 255, 255, 0.95)" : "#ff80a0" }}>
                            {selectedSize || "Please select a size"}
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
                          : sizes.length > 0 && !selectedSize
                          ? "Select a Size to Pre-order"
                          : colors.length > 0 && !selectedColor
                          ? "Select a Color to Pre-order"
                          : `Add to Pre-Order — ₱${(effectivePrice * qty).toLocaleString()}`}
                      </button>
                    </div>
                    {activeProduct.preorderRemaining !== null && (
                      <p
                        style={{
                          textAlign: "center",
                          fontSize: "var(--text-xs)",
                          color: "#ff8fa0",
                          fontWeight: 600,
                          margin: 0,
                          textShadow: "0 0 10px rgba(255, 143, 160, 0.4)",
                        }}
                      >
                        Only {activeProduct.preorderRemaining} slots left in this drop!
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className={styles.catalogueCol}>
          <div className={styles.catalogueHeader}>
            <h3 className={styles.catalogueTitle}>Collection Pieces</h3>
            <span className="badge badge-open">
              {filteredProducts.length} item{filteredProducts.length !== 1 ? "s" : ""}
            </span>
          </div>
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
          <div className={styles.iconGrid}>
            {(showAllCatalogue ? filteredProducts : filteredProducts.slice(0, 8)).map((p) => {
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
                  aria-label={`Select ${p.name}`}
                >
                  <div className={styles.smallThumbWrap}>
                    {p.images[0] ? (
                      <img src={p.images[0]} alt={p.name} className={styles.smallThumbImg} />
                    ) : (
                      <span className={styles.smallPlaceholder}>
                        <GarmentSilhouette category={p.category} name={p.name} size={28} />
                      </span>
                    )}
                  </div>
                  <div className={styles.smallCardBody}>
                    <h4 className={styles.smallProductName}>{p.name}</h4>
                    <div className={styles.smallPriceRow}>
                      <span className={styles.smallProductPrice}>
                        ₱{p.price.toLocaleString()}
                      </span>
                      {p.preorderStatus !== "OPEN" && (
                        <span className={styles.smallStatusDot}>
                          {p.preorderStatus === "SOLD_OUT"
                            ? "Sold Out"
                            : p.preorderStatus === "COMING_SOON"
                            ? "Coming Soon"
                            : p.preorderStatus}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {filteredProducts.length > 8 && (
            <div style={{ textAlign: "center", marginTop: "var(--space-3)" }}>
              <button
                type="button"
                className={styles.viewMoreBtn}
                onClick={() => setShowAllCatalogue((prev) => !prev)}
              >
                {showAllCatalogue
                  ? "Show Less Pieces ↑"
                  : `View All ${filteredProducts.length} Pieces ↓`}
              </button>
            </div>
          )}
        </div>
      </div>
      {itemCount > 0 && (
        <div className={styles.mobileFloatingCart}>
          <Link href="/cart" className="btn btn-primary btn-full btn-lg" style={{ boxShadow: "var(--shadow-xl)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "var(--space-2)" }}>
            <CustomBagIcon size={18} /> View Order ({itemCount} item{itemCount !== 1 ? "s" : ""}) →
          </Link>
        </div>
      )}
    </div>
  );
}
