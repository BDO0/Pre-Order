"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/cart";
import { SITE_NAME, SHOP_INSTAGRAM_HANDLE, SHOP_INSTAGRAM_URL } from "@/lib/site";
import { CustomBagIcon, GarmentSilhouette } from "@/components/CustomerIcons";
import { BrandLogo } from "@/components/BrandLogo";
import { CartCountBadge } from "@/components/CartCountBadge";
import { TrustFooter } from "@/components/TrustFooter";
import { DeliveryEta } from "@/components/DeliveryEta";
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
function CountdownTimer({ targetDate }: { targetDate: string }) {
  const [label, setLabel] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const describe = (): string | null => {
      const remaining = new Date(targetDate).getTime() - Date.now();
      if (remaining <= 0) return null;
      const days = Math.floor(remaining / 86_400_000);
      const hours = Math.floor((remaining / 3_600_000) % 24);
      const minutes = Math.floor((remaining / 60_000) % 60);
      const seconds = Math.floor((remaining / 1000) % 60);
      return days > 0
        ? `Closes in ${days}d ${hours}h ${minutes}m`
        : `Closes in ${hours}h ${minutes}m ${seconds}s`;
    };

    const tick = () => setLabel(describe());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [targetDate]);

  if (!mounted) {
    return <span className="badge badge-open" style={{ visibility: "hidden" }}>Closes in 00h 00m 00s</span>;
  }
  if (!label) return null;
  return <span className="badge badge-open">{label}</span>;
}

export default function ProductPageClient({ product, batch }: { product: Product; batch: Batch }) {
  const { addItem, getItemCount, clearCart, items } = useCartStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const isClosed = batch.status === "CLOSED" || product.preorderStatus === "CLOSED" || product.preorderStatus === "SOLD_OUT";
  const isOrderable = !isClosed && product.preorderStatus === "OPEN";
  const itemCount = mounted ? getItemCount() : 0;
  const colors = [...new Set(product.variants.filter((v) => v.color).map((v) => v.color!))];
  const sizes = [...new Set(product.variants.filter((v) => v.size).map((v) => v.size!))];
  const [selectedColor, setSelectedColor] = useState<string | null>(colors[0] ?? null);
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
    const v = product.variants.find(
      (v) =>
        (colors.length === 0 || v.color === color) &&
        (sizes.length === 0 || v.size === size)
    );
    if (!v || !v.active) return false;
    if (v.remainingCapacity !== null && v.remainingCapacity <= 0) return false;
    return true;
  };
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
                        padding: "4px"
                      }}>
                        {product.images.map((img, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setHeroImageIndex(idx)}
                            aria-label={`Show image ${idx + 1}`}
                            aria-current={idx === safeHeroIndex}
                            style={{
                              width: "48px",
                              height: "48px",
                              borderRadius: "8px",
                              border: idx === safeHeroIndex ? "2px solid #fff" : "2px solid rgba(255,255,255,0.4)",
                              overflow: "hidden",
                              flexShrink: 0,
                              cursor: "pointer",
                              background: "#000"
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
                  {batch.endAt && <CountdownTimer targetDate={batch.endAt} />}
                  {batch.status === "CLOSED" && (
                    <span className="badge badge-closed">Batch Closed</span>
                  )}
                  {product.preorderStatus === "SOLD_OUT" && (
                    <span className="badge badge-closed">Sold Out</span>
                  )}
                </div>
                <h1 className={styles.productTitle}>{product.name}</h1>
                <p className={styles.productPrice}>
                  ₱{effectivePrice.toLocaleString("en-US")}
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
                        <span style={{ color: "rgba(255, 255, 255, 0.95)", fontWeight: 600 }}>{selectedColor ?? "None"}</span>
                      </div>
                      <div className={styles.variantOptions}>
                        {colors.map((color) => (
                          <button
                            key={color}
                            id={`color-${color.toLowerCase()}`}
                            className={`${styles.variantBtn} ${
                              selectedColor === color ? styles.selected : ""
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
                      : sizes.length > 0 && !selectedSize
                      ? "Select a Size to Pre-order"
                      : colors.length > 0 && !selectedColor
                      ? "Select a Color to Pre-order"
                      : `Add to Order — ₱${(effectivePrice * qty).toLocaleString("en-US")}`}
                  </button>
                  <DeliveryEta batchEndAt={batch.endAt} />
                  {product.preorderRemaining !== null && (
                    <p className={styles.remainingText}>
                      Only {product.preorderRemaining} left in this drop
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
