"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/cart";
import { SITE_NAME, SHOP_INSTAGRAM_HANDLE, SHOP_INSTAGRAM_URL } from "@/lib/site";
import { CustomBagIcon, GarmentSilhouette } from "@/components/CustomerIcons";
import { BrandLogo } from "@/components/BrandLogo";
import { CartCountBadge } from "@/components/CartCountBadge";
import { TrustFooter } from "@/components/TrustFooter";
import { DeliveryEta } from "@/components/DeliveryEta";
import { Countdown } from "@/components/Countdown";
import { formatMoney } from "@/lib/format";
import glass from "@/app/glass.module.css";
import { HERO_HEIGHT, HERO_SIZES, HERO_WIDTH, imageSrcSet, imageUrlAtWidth } from "@/lib/image-geometry";
import styles from "./campaign.module.css";
interface Variant {
  id: string;
  size: string | null;
  color: string | null;
  sku: string | null;
  priceOverride: number | null;
  capacity: number | null;
  remainingCapacity: number | null;
  active: boolean;
}
interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  currency: string;
  images: string[];
  preorderStatus: string;
  preorderRemaining: number | null;
  variants: Variant[];
}
export interface Batch {
  id: string;
  name: string;
  slug: string;
  status: string;
  endAt: string | null;
}
export default function ProductPageClient({ product, batch }: { product: Product; batch: Batch }) {
  const { addItem, getItemCount, clearCart, items } = useCartStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const isClosed = batch.status === "CLOSED" || product.preorderStatus === "CLOSED" || product.preorderStatus === "SOLD_OUT";
  const isOrderable = !isClosed && product.preorderStatus === "OPEN";
  const itemCount = mounted ? getItemCount() : 0;
  const colors = [...new Set(product.variants.filter((v) => v.color).map((v) => v.color!))];
  const sizes = [...new Set(product.variants.filter((v) => v.size).map((v) => v.size!))];
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [heroImageIndex, setHeroImageIndex] = useState(0);
  const [showClearCartModal, setShowClearCartModal] = useState(false);
  const safeHeroIndex = Math.min(heroImageIndex, Math.max(0, product.images.length - 1));

  useEffect(() => {
    if (showClearCartModal) {
      document.body.style.overflow = "hidden";
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setShowClearCartModal(false);
        }
      };
      window.addEventListener("keydown", handleEsc);
      return () => {
        document.body.style.overflow = "";
        window.removeEventListener("keydown", handleEsc);
      };
    }
  }, [showClearCartModal]);
  const selectedVariant =
    (sizes.length > 0 && !selectedSize) || (colors.length > 0 && !selectedColor)
      ? null
      : product.variants.find(
          (v) =>
            (colors.length === 0 || v.color === selectedColor) &&
            (sizes.length === 0 || v.size === selectedSize)
        ) ?? (colors.length === 0 && sizes.length === 0 ? product.variants[0] : null);

  const isVariantAvailable = (color: string | null, size: string | null) => {
    if (colors.length > 0 && color) {
      const v = product.variants.find(
        (variant) =>
          variant.color === color &&
          (sizes.length === 0 || variant.size === size)
      );
      if (!v || !v.active) return false;
      if (v.remainingCapacity !== null && v.remainingCapacity <= 0) return false;
      return true;
    }
    const matching = product.variants.filter(
      (variant) => (sizes.length === 0 || variant.size === size) && variant.active
    );
    if (matching.length === 0) return false;
    return matching.some(
      (v) => v.remainingCapacity === null || v.remainingCapacity > 0
    );
  };

  const isColorAvailable = (color: string) => {
    if (sizes.length > 0 && selectedSize) {
      const v = product.variants.find(
        (variant) => variant.color === color && variant.size === selectedSize && variant.active
      );
      if (!v) return false;
      if (v.remainingCapacity !== null && v.remainingCapacity <= 0) return false;
      return true;
    }
    const matching = product.variants.filter(
      (variant) => variant.color === color && variant.active
    );
    if (matching.length === 0) return false;
    return matching.some(
      (v) => v.remainingCapacity === null || v.remainingCapacity > 0
    );
  };

  const availabilityInfo = useMemo(() => {
    const activeVariants = product.variants.filter((v) => v.active);
    if (activeVariants.length === 0) {
      return { count: 0, label: "Sold out", isSoldOut: true };
    }

    const hasColorSelection = colors.length === 0 || selectedColor !== null;
    const hasSizeSelection = sizes.length === 0 || selectedSize !== null;

    if (hasColorSelection && hasSizeSelection) {
      const variant = activeVariants.find(
        (v) =>
          (colors.length === 0 || v.color === selectedColor) &&
          (sizes.length === 0 || v.size === selectedSize)
      );
      if (!variant) {
        return { count: 0, label: "Unavailable for this selection", isSoldOut: true };
      }
      const desc = [variant.color, variant.size].filter(Boolean).join(" / ");
      if (variant.remainingCapacity !== null) {
        const remaining = product.preorderRemaining !== null
          ? Math.min(variant.remainingCapacity, product.preorderRemaining)
          : variant.remainingCapacity;
        return {
          count: remaining,
          label: remaining > 0 ? `${remaining} available for ${desc}` : `Sold out for ${desc}`,
          isSoldOut: remaining <= 0,
        };
      }
      const remaining = product.preorderRemaining;
      return {
        count: remaining,
        label: remaining !== null ? `${remaining} available for ${desc}` : `Available for ${desc}`,
        isSoldOut: false,
      };
    }

    if (selectedColor && !selectedSize) {
      const colorVariants = activeVariants.filter((v) => v.color === selectedColor);
      const hasUnlimited = colorVariants.some((v) => v.remainingCapacity === null);
      const colorTotal = colorVariants.reduce(
        (sum, v) => sum + (v.remainingCapacity ?? 0),
        0
      );
      if (!hasUnlimited) {
        const remaining = product.preorderRemaining !== null
          ? Math.min(colorTotal, product.preorderRemaining)
          : colorTotal;
        return {
          count: remaining,
          label: remaining > 0 ? `${remaining} available for ${selectedColor}` : `Sold out for ${selectedColor}`,
          isSoldOut: remaining <= 0,
        };
      }
      const remaining = product.preorderRemaining;
      return {
        count: remaining,
        label: remaining !== null ? `${remaining} available for ${selectedColor}` : `Available for ${selectedColor}`,
        isSoldOut: false,
      };
    }

    if (!selectedColor && selectedSize) {
      const sizeVariants = activeVariants.filter((v) => v.size === selectedSize);
      const hasUnlimited = sizeVariants.some((v) => v.remainingCapacity === null);
      const sizeTotal = sizeVariants.reduce(
        (sum, v) => sum + (v.remainingCapacity ?? 0),
        0
      );
      if (!hasUnlimited) {
        const remaining = product.preorderRemaining !== null
          ? Math.min(sizeTotal, product.preorderRemaining)
          : sizeTotal;
        return {
          count: remaining,
          label: remaining > 0 ? `${remaining} available for size ${selectedSize}` : `Sold out for size ${selectedSize}`,
          isSoldOut: remaining <= 0,
        };
      }
      const remaining = product.preorderRemaining;
      return {
        count: remaining,
        label: remaining !== null ? `${remaining} available for size ${selectedSize}` : `Available for size ${selectedSize}`,
        isSoldOut: false,
      };
    }

    const hasUnlimited = activeVariants.some((v) => v.remainingCapacity === null);
    const totalVariantRemaining = activeVariants.reduce(
      (sum, v) => sum + (v.remainingCapacity ?? 0),
      0
    );
    if (!hasUnlimited) {
      const remaining = product.preorderRemaining !== null
        ? Math.min(totalVariantRemaining, product.preorderRemaining)
        : totalVariantRemaining;
      return {
        count: remaining,
        label: remaining > 0 ? `${remaining} available in total` : "Sold out",
        isSoldOut: remaining <= 0,
      };
    }
    const remaining = product.preorderRemaining;
    return {
      count: remaining,
      label: remaining !== null ? `${remaining} available in total` : "Available for pre-order",
      isSoldOut: false,
    };
  }, [product, colors.length, sizes.length, selectedColor, selectedSize]);

  const canAdd =
    isOrderable &&
    Boolean(selectedVariant) &&
    Boolean(selectedVariant?.active) &&
    (selectedVariant?.remainingCapacity === null || (selectedVariant?.remainingCapacity ?? 0) >= qty);
  const handleAdd = () => {
    if (!selectedVariant || !canAdd) return;
    const success = addItem(
      { id: product.id, name: product.name, images: product.images, price: product.price },
      selectedVariant,
      qty,
      batch.id,
      batch.slug
    );
    if (!success) {
      setShowClearCartModal(true);
      return;
    }
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  const confirmClearCart = () => {
    if (!selectedVariant) return;
    clearCart();
    addItem(
      { id: product.id, name: product.name, images: product.images, price: product.price },
      selectedVariant,
      qty,
      batch.id,
      batch.slug
    );
    setShowClearCartModal(false);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };
  const effectivePrice = selectedVariant?.priceOverride
    ? Number(selectedVariant.priceOverride)
    : Number(product.price);
  return (
    <div className={`${glass.glassPage} ${styles.page}`}>
      <div className={glass.bg} />
      <div className={glass.orb1} />
      <div className={glass.orb2} />
      <div className={glass.orb3} />
      <div className={glass.content}>
        <nav className={glass.nav}>
          <div className={glass.navInner}>
            <Link href="/" className={glass.navBrand} aria-label={SITE_NAME}>
              <BrandLogo variant="horizontal" height={34} />
            </Link>
            <div className={glass.navActions}>
              <Link href="/" className={glass.navGhostBtn} aria-label="Back to Shop">
                ← <span className={glass.mobileHideText}>Back to </span>Shop
              </Link>
              <Link href="/cart" className={glass.navCartBtn} id="cart-link" aria-label="View Cart">
                <CustomBagIcon size={16} />
                <span>Cart</span>
                <CartCountBadge />
              </Link>
            </div>
          </div>
        </nav>
        <main className={styles.mainContent}>
          <Link href="/" className={styles.backLink}>
            ← Back to Catalogue
          </Link>
          <div className={styles.productGrid}>
            <div className={styles.imageCard}>
              <div className={styles.mediaFrame}>
                {product.images[safeHeroIndex] ? (
                  <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
                    <>
                      {


}
                      <img
                        src={product.images[safeHeroIndex]}
                        alt=""
                        aria-hidden="true"
                        className={styles.productImgBackdrop}
                      />
                      <img
                        src={product.images[safeHeroIndex]}
                        alt={product.name}
                        className={styles.productImg}
                        srcSet={imageSrcSet(product.images[safeHeroIndex])}
                        sizes={HERO_SIZES}
                        width={HERO_WIDTH}
                        height={HERO_HEIGHT}
                        decoding="async"
                        fetchPriority="high"
                      />
                    </>
                    {product.images.length > 1 && (
                      <div style={{
                        position: "absolute",
                        bottom: "var(--space-3)",
                        left: "50%",
                        transform: "translateX(-50%)",
                        display: "flex",
                        gap: "8px",
                        zIndex: 10,
                        maxWidth: "90%",
                        overflowX: "auto",
                        padding: "6px 10px",
                        background: "rgba(24, 3, 10, 0.75)",
                        backdropFilter: "blur(16px)",
                        WebkitBackdropFilter: "blur(16px)",
                        borderRadius: "var(--radius-full)",
                        border: "1px solid rgba(216, 183, 140, 0.35)",
                        boxShadow: "0 8px 24px rgba(14, 0, 4, 0.6)"
                      }}>
                        {product.images.map((img, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setHeroImageIndex(idx)}
                            aria-label={`Show image ${idx + 1}`}
                            aria-current={idx === safeHeroIndex}
                            style={{
                              width: "44px",
                              height: "44px",
                              borderRadius: "var(--radius-md)",
                              border: idx === safeHeroIndex ? "2px solid #D8B78C" : "1.5px solid rgba(216, 183, 140, 0.35)",
                              overflow: "hidden",
                              flexShrink: 0,
                              cursor: "pointer",
                              background: "rgba(10, 1, 4, 0.6)",
                              boxShadow: idx === safeHeroIndex ? "0 0 10px rgba(216, 183, 140, 0.5)" : "none",
                              transition: "all var(--transition-fast)"
                            }}
                          >
                            <img src={imageUrlAtWidth(img, 400)} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className={styles.placeholderArt}>
                    <GarmentSilhouette category={product.name} name={product.name} size={64} />
                  </div>
                )}
              </div>
            </div>
            <div className={styles.infoCol}>
              <div>
                <div className={styles.badgeRow} style={{ marginBottom: "var(--space-3)" }}>
                  <span className={styles.batchBadge}>{batch.name}</span>
                  {batch.endAt && <Countdown targetDate={batch.endAt} />}
                  {batch.status === "CLOSED" && (
                    <span className="badge badge-closed">Batch Closed</span>
                  )}
                  {product.preorderStatus === "SOLD_OUT" && (
                    <span className="badge badge-closed">Sold Out</span>
                  )}
                </div>
                <h1 className={styles.productTitle}>{product.name}</h1>
                <p className={styles.productPrice}>
                  {formatMoney(effectivePrice, product.currency)}
                </p>
              </div>
              {product.description && (
                <p className={styles.productDesc}>{product.description}</p>
              )}
              {!isOrderable ? (
                <div
                  className={styles.formCard}
                  style={{ textAlign: "center", padding: "var(--space-8)" }}
                >
                  <p style={{ fontSize: "var(--text-lg)", fontWeight: 600, color: "rgba(255, 255, 255, 0.9)" }}>
                    {product.preorderStatus === "COMING_SOON"
                      ? "Coming Soon"
                      : "Currently Unavailable"}
                  </p>
                </div>
              ) : (
                <div className={styles.formCard}>
                  {colors.length > 0 && (
                    <div>
                      <div className={styles.fieldLabel}>
                        <span>Select Color</span>
                        <span style={{ color: selectedColor ? "rgba(255, 255, 255, 0.95)" : "#ff80a0", fontWeight: 600 }}>
                          {selectedColor ?? "Please select a color"}
                        </span>
                      </div>
                      <div className={styles.variantOptions}>
                        {colors.map((color) => {
                          const available = isColorAvailable(color);
                          return (
                            <button
                              key={color}
                              id={`color-${color.toLowerCase()}`}
                              className={`${styles.variantBtn} ${
                                selectedColor === color ? styles.selected : ""
                              } ${!available ? styles.disabledVariant : ""}`}
                              onClick={() => {
                                if (!available) return;
                                setSelectedColor(color);
                                if (selectedSize && !isVariantAvailable(color, selectedSize)) {
                                  setSelectedSize(null);
                                }
                              }}
                              disabled={!available}
                              aria-disabled={!available}
                            >
                              {color}
                              {!available && <span className={styles.soldOutX}>✗</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {sizes.length > 0 && (
                    <div>
                      <div className={styles.fieldLabel}>
                        <span>Select Size</span>
                        <span style={{ color: selectedSize ? "rgba(255, 255, 255, 0.95)" : "#ff80a0", fontWeight: 600 }}>
                          {selectedSize ?? "Please select a size"}
                        </span>
                      </div>
                      <div className={styles.variantOptions}>
                        {sizes.map((size) => {
                          const available = isVariantAvailable(selectedColor, size);
                          return (
                            <button
                              key={size}
                              id={`size-${size.toLowerCase()}`}
                              className={`${styles.variantBtn} ${
                                selectedSize === size ? styles.selected : ""
                              } ${!available ? styles.disabledVariant : ""}`}
                              onClick={() => available && setSelectedSize(size)}
                              disabled={!available}
                              aria-disabled={!available}
                            >
                              {size}
                              {!available && <span className={styles.soldOutX}>✗</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className={styles.fieldLabel}>
                      <span>Quantity</span>
                    </div>
                    <div className={styles.qtyControl}>
                      <button
                        className={styles.qtyBtn}
                        onClick={() => setQty((q) => Math.max(1, q - 1))}
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span className={styles.qtyValue}>{qty}</span>
                      <button
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
                  </div>
                  <button
                    id="confirm-add-to-order"
                    className={`${styles.submitBtn} ${added ? styles.addedBtn : ""}`}
                    onClick={handleAdd}
                    disabled={!canAdd || added}
                  >
                    {added
                      ? "✓ Added to Order!"
                      : colors.length > 0 && !selectedColor
                      ? "Select a Color to Pre-order"
                      : sizes.length > 0 && !selectedSize
                      ? "Select a Size to Pre-order"
                      : !canAdd && selectedVariant && (selectedVariant.remainingCapacity !== null && selectedVariant.remainingCapacity <= 0)
                      ? "Sold Out"
                      : `Add to Order — ${formatMoney(effectivePrice * qty, product.currency)}`}
                  </button>
                  <DeliveryEta batchEndAt={batch.endAt} />
                  {availabilityInfo.label && (
                    <p
                      id="product-availability-text"
                      className={styles.remainingText}
                      style={{
                        color: availabilityInfo.isSoldOut ? "#ff8fa0" : "#86efac",
                        textShadow: availabilityInfo.isSoldOut
                          ? "0 0 10px rgba(255, 143, 160, 0.4)"
                          : "0 0 10px rgba(134, 239, 172, 0.4)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: availabilityInfo.isSoldOut ? "#f87171" : "#10b981",
                        }}
                      />
                      {availabilityInfo.label}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
        <section style={{ maxWidth: "760px", margin: "var(--space-6) auto var(--space-16)", paddingInline: "var(--space-4)", position: "relative", zIndex: 1 }}>
          <div
            className={glass.glassCard}
            style={{
              padding: "var(--space-8) var(--space-6)",
              textAlign: "center",
            }}
          >
            <h2
              className={glass.pageTitleEditorial}
              style={{
                fontSize: "1.5rem",
                marginBottom: "var(--space-2)",
              }}
            >
              How pre-ordering works
            </h2>
            <p
              style={{
                fontSize: "var(--text-sm)",
                color: "rgba(255, 255, 255, 0.7)",
                maxWidth: "560px",
                margin: "0 auto var(--space-5)",
                lineHeight: 1.6,
              }}
            >
              Reserve your pieces here — no payment is taken on this site. We message you
              on Instagram to confirm sizing, shipping and payment, and your order is
              reserved the moment you place it.
            </p>
            <div
              style={{
                display: "flex",
                gap: "var(--space-4)",
                justifyContent: "center",
                flexWrap: "wrap",
                fontSize: "var(--text-xs)",
                color: "rgba(255, 255, 255, 0.8)",
                marginBottom: "var(--space-5)",
              }}
            >
              <span>✓ Limited, made-to-order pieces</span>
              <span>✓ Confirmed personally on Instagram</span>
              <span>✓ Your own private order link</span>
            </div>
            <a
              href={SHOP_INSTAGRAM_URL}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
              style={{ display: "inline-block" }}
            >
              Message us @{SHOP_INSTAGRAM_HANDLE}
            </a>
          </div>
        </section>
        <TrustFooter batchEndAt={batch.endAt} />
        {itemCount > 0 && (
          <div className={styles.floatingCart}>
            <Link href="/cart" className="btn btn-primary btn-lg btn-full">
              View Order ({itemCount} item{itemCount !== 1 ? "s" : ""}) →
            </Link>
          </div>
        )}
        {showClearCartModal && (
          <div className={styles.viewer} style={{ background: "rgba(0,0,0,0.8)", alignItems: "center", justifyContent: "center" }}>
            <div className={glass.glassCard} style={{ padding: "var(--space-6)", maxWidth: "400px", margin: "var(--space-4)", textAlign: "center", zIndex: 100 }}>
              <h3 style={{ marginBottom: "var(--space-4)", fontSize: "1.25rem", fontWeight: 700 }}>This is a separate pre-order</h3>
              <p style={{ marginBottom: "var(--space-3)", color: "rgba(255,255,255,0.8)" }}>Each drop is its own pre-order, so ordering this piece will remove what you already have:</p>
              <ul style={{ marginBottom: "var(--space-6)", listStyle: "none", padding: 0, color: "#fff", fontSize: "var(--text-sm)", display: "grid", gap: "var(--space-1)" }}>
                {items.map((cartLine) => (
                  <li key={cartLine.id}>
                    {cartLine.quantity} x {cartLine.product.name}
                    {cartLine.variant.size ? ` / ${cartLine.variant.size}` : ""}
                    {cartLine.variant.color ? ` / ${cartLine.variant.color}` : ""}
                  </li>
                ))}
              </ul>
              <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "center" }}>
                <button className="btn btn-ghost" onClick={() => setShowClearCartModal(false)}>Keep my cart</button>
                <button className="btn btn-primary" onClick={confirmClearCart}>Clear and add this</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
