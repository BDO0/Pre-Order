"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/cart";
import { imagesForColor, primaryImageForColor, getColorSwatch } from "@/lib/product-color-images";
import { SHOP_INSTAGRAM_HANDLE, SHOP_INSTAGRAM_URL, SITE_NAME } from "@/lib/site";
import { CustomBagIcon, CustomHangerIcon, GarmentSilhouette } from "@/components/CustomerIcons";
import { DeliveryEta } from "@/components/DeliveryEta";
import { Countdown } from "@/components/Countdown";
import { ProductLightbox } from "@/components/ProductLightbox";
import { formatMoney } from "@/lib/format";
import { quantityCap } from "@/lib/variant-stock";
import styles from "./storefront.module.css";
import { CARD_SIZES, HERO_HEIGHT, HERO_SIZES, HERO_WIDTH, imageSrcSet, imageUrlAtWidth } from "@/lib/image-geometry";
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
  colorImages?: Record<string, string[]>;
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
  campaignTitle?: string | null;
  campaignDescription?: string | null;
  campaignEndAt?: string | null;
}

function syncStorefrontUrl(pieceSlug: string | undefined, color: string | null) {
  if (typeof window === "undefined" || !pieceSlug) return;
  const url = new URL(window.location.href);
  url.searchParams.set("piece", pieceSlug);
  if (color) url.searchParams.set("color", color);
  else url.searchParams.delete("color");
  window.history.replaceState(null, "", url.toString());
}

export default function StorefrontClient({
  products,
  campaignStatus,
  campaignTitle,
  campaignDescription,
  campaignEndAt,
}: Props) {
  const { addItem, getItemCount, clearCart, items } = useCartStore();
  const [mounted, setMounted] = useState(false);
  const showcaseRef = useRef<HTMLDivElement>(null);
  const [highlightPulse, setHighlightPulse] = useState(false);
  const [showAllCatalogue, setShowAllCatalogue] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const itemCount = mounted ? getItemCount() : 0;
  const [selectedProductId, setSelectedProductId] = useState<string>(
    products[0]?.id ?? ""
  );
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const activeProduct = useMemo(() => {
    const p = products.find((p) => p.id === selectedProductId);
    if (p && (selectedCategory === "ALL" || p.category === selectedCategory)) return p;
    return products.find(p => selectedCategory === "ALL" || p.category === selectedCategory) || products[0];
  }, [products, selectedProductId, selectedCategory]);
  const colors = useMemo(() => {
    if (!activeProduct?.variants) return [];
    return [...new Set(activeProduct.variants.filter((v) => v.color).map((v) => v.color!))];
  }, [activeProduct]);
  const sizes = useMemo(() => {
    if (!activeProduct?.variants) return [];
    return [...new Set(activeProduct.variants.filter((v) => v.size).map((v) => v.size!))];
  }, [activeProduct]);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [heroImageIndex, setHeroImageIndex] = useState(0);
  const [showClearCartModal, setShowClearCartModal] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [flipDirection, setFlipDirection] = useState<"forward" | "backward">("forward");
  const [isFlipping, setIsFlipping] = useState(false);

  // Pending flip timers. They must be cancelled whenever the showcased product
  // changes, otherwise a colour picked on the previous product lands on the new
  // one ~220ms later and the add button falsely reads "Sold Out".
  const flipTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearFlipTimers = () => {
    flipTimersRef.current.forEach(clearTimeout);
    flipTimersRef.current = [];
  };
  useEffect(() => clearFlipTimers, []);

  const applyColor = (color: string) => {
    setSelectedColor(color);
    setHeroImageIndex(0);
    if (selectedSize && !isVariantAvailable(color, selectedSize)) {
      setSelectedSize(null);
    }
    syncStorefrontUrl(activeProduct?.slug, color);
  };

  const handleColorChange = (color: string) => {
    if (color === selectedColor) return;

    // Respect the OS "reduce motion" setting: switch instantly, no flip.
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      applyColor(color);
      return;
    }

    const currentIdx = selectedColor ? colors.indexOf(selectedColor) : 0;
    const targetIdx = colors.indexOf(color);
    const direction: "forward" | "backward" = targetIdx >= currentIdx ? "forward" : "backward";

    clearFlipTimers();
    setFlipDirection(direction);
    setIsFlipping(true);

    flipTimersRef.current.push(
      setTimeout(() => applyColor(color), 150),
      setTimeout(() => {
        setIsFlipping(false);
        flipTimersRef.current = [];
      }, 320)
    );
  };

  const prevProductIdRef = useRef<string>(activeProduct?.id ?? "");
  useEffect(() => {
    if (typeof window === "undefined" || products.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const pieceSlug = params.get("piece");
    const colorParam = params.get("color");
    if (!pieceSlug) return;
    const matched = products.find((p) => p.slug === pieceSlug);
    if (!matched) return;
    prevProductIdRef.current = matched.id;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedProductId(matched.id);
    if (colorParam && matched.variants.some((v) => v.color === colorParam)) {
      setSelectedColor(colorParam);
    }
  }, [products]);
  useEffect(() => {
    if (activeProduct && activeProduct.id !== prevProductIdRef.current) {
      prevProductIdRef.current = activeProduct.id;
      clearFlipTimers();
      setIsFlipping(false);
      setLightboxOpen(false);
      setSelectedColor(null);
      setSelectedSize(null);
      setQty(1);
      setHeroImageIndex(0);
    }
  }, [activeProduct]);

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

  const gallery = useMemo(
    () => imagesForColor(activeProduct, selectedColor),
    [activeProduct, selectedColor]
  );
  const safeHeroIndex = Math.min(heroImageIndex, Math.max(0, gallery.length - 1));

  // Warm the browser cache with each colourway's hero shot so the image swap at
  // the flip midpoint never lands on a blank or stale frame.
  useEffect(() => {
    if (!activeProduct || typeof window === "undefined") return;
    const seen = new Set<string>();
    for (const color of colors) {
      const url = primaryImageForColor(activeProduct, color);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const img = new Image();
      img.sizes = HERO_SIZES;
      const srcSet = imageSrcSet(url);
      if (srcSet) img.srcset = srcSet;
      img.src = url;
    }
  }, [activeProduct, colors]);

  const handleSelectProduct = (product: StorefrontProduct, autoScroll = true) => {
    clearFlipTimers();
    setIsFlipping(false);
    setLightboxOpen(false);
    setSelectedProductId(product.id);
    setSelectedColor(null);
    setSelectedSize(null);
    setQty(1);
    setAdded(false);
    setHeroImageIndex(0);
    setHighlightPulse(true);
    setTimeout(() => setHighlightPulse(false), 800);
    syncStorefrontUrl(product.slug, null);
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

  /**
   * The most units a single line may hold: the variant's own stock, also capped
   * by the product's overall pre-order limit, and 99 when both are unlimited.
   *
   * `remainingCapacity` alone is not enough - a product with unlimited variant
   * stock and a `preorderLimit` of 5 would let a shopper build a basket of 10 and
   * only be rejected at checkout.
   */
  const qtyCap = quantityCap(selectedVariant, activeProduct?.preorderRemaining);

  // Switching to a colour or size with less stock must not leave the stepper on a
  // quantity that silently disables "Add to Pre-Order". The amount that is shown
  // and submitted is therefore derived from the cap rather than synced into state
  // from an effect: `qty` is only what the shopper asked for, `cappedQty` is real.
  const maxQty = Math.max(1, qtyCap);
  const cappedQty = Math.min(qty, maxQty);
  const isClosed =
    campaignStatus === "CLOSED" ||
    activeProduct?.preorderStatus === "CLOSED" ||
    activeProduct?.preorderStatus === "SOLD_OUT";
  const isOrderable =
    !isClosed &&
    activeProduct?.preorderStatus === "OPEN";

  const isVariantAvailable = (color: string | null, size: string | null) => {
    if (!activeProduct) return false;
    if (colors.length > 0 && color) {
      const v = activeProduct.variants.find(
        (variant) =>
          variant.color === color &&
          (sizes.length === 0 || variant.size === size)
      );
      if (!v || !v.active) return false;
      if (v.remainingCapacity !== null && v.remainingCapacity <= 0) return false;
      return true;
    }
    const matching = activeProduct.variants.filter(
      (variant) => (sizes.length === 0 || variant.size === size) && variant.active
    );
    if (matching.length === 0) return false;
    return matching.some(
      (v) => v.remainingCapacity === null || v.remainingCapacity > 0
    );
  };

  const isColorAvailable = (color: string) => {
    if (!activeProduct) return false;
    // Availability of the colour as a whole, deliberately ignoring the size the
    // shopper happens to have picked. Each colourway has its own gallery, so
    // gating the pills on one size/size-combination would hide a colour that is
    // still orderable in another size and make a sold-out colourway impossible
    // to even look at. The size pills below still do the exact combination check.
    const matching = activeProduct.variants.filter(
      (variant) => variant.color === color && variant.active
    );
    if (matching.length === 0) return false;
    return matching.some(
      (v) => v.remainingCapacity === null || v.remainingCapacity > 0
    );
  };

  const availabilityInfo = useMemo(() => {
    if (!activeProduct || !activeProduct.variants) {
      return { count: null, label: "", isSoldOut: false };
    }
    const activeVariants = activeProduct.variants.filter((v) => v.active);
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
        const remaining = activeProduct.preorderRemaining !== null
          ? Math.min(variant.remainingCapacity, activeProduct.preorderRemaining)
          : variant.remainingCapacity;
        return {
          count: remaining,
          label: remaining > 0 ? `${remaining} available for ${desc}` : `Sold out for ${desc}`,
          isSoldOut: remaining <= 0,
        };
      }
      const remaining = activeProduct.preorderRemaining;
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
        const remaining = activeProduct.preorderRemaining !== null
          ? Math.min(colorTotal, activeProduct.preorderRemaining)
          : colorTotal;
        return {
          count: remaining,
          label: remaining > 0 ? `${remaining} available for ${selectedColor}` : `Sold out for ${selectedColor}`,
          isSoldOut: remaining <= 0,
        };
      }
      const remaining = activeProduct.preorderRemaining;
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
        const remaining = activeProduct.preorderRemaining !== null
          ? Math.min(sizeTotal, activeProduct.preorderRemaining)
          : sizeTotal;
        return {
          count: remaining,
          label: remaining > 0 ? `${remaining} available for size ${selectedSize}` : `Sold out for size ${selectedSize}`,
          isSoldOut: remaining <= 0,
        };
      }
      const remaining = activeProduct.preorderRemaining;
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
      const remaining = activeProduct.preorderRemaining !== null
        ? Math.min(totalVariantRemaining, activeProduct.preorderRemaining)
        : totalVariantRemaining;
      return {
        count: remaining,
        label: remaining > 0 ? `${remaining} available in total` : "Sold out",
        isSoldOut: remaining <= 0,
      };
    }
    const remaining = activeProduct.preorderRemaining;
    return {
      count: remaining,
      label: remaining !== null ? `${remaining} available in total` : "Available for pre-order",
      isSoldOut: false,
    };
  }, [activeProduct, colors.length, sizes.length, selectedColor, selectedSize]);
  const effectivePrice = selectedVariant?.priceOverride
    ? Number(selectedVariant.priceOverride)
    : activeProduct
    ? Number(activeProduct.price)
    : 0;
  const canAdd =
    isOrderable &&
    Boolean(selectedVariant) &&
    Boolean(selectedVariant?.active) &&
    qtyCap >= 1;
  const handleAdd = () => {
    if (!activeProduct || !selectedVariant || !canAdd) return;
    const success = addItem(
      {
        id: activeProduct.id,
        name: activeProduct.name,
        images: activeProduct.images,
        imageUrl: primaryImageForColor(activeProduct, selectedColor) ?? undefined,
        price: activeProduct.price,
      },
      selectedVariant,
      cappedQty,
      activeProduct.batchId,
      activeProduct.batchSlug
    );
    if (!success) {
      setShowClearCartModal(true);
      return;
    }
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  const confirmClearCart = () => {
    if (!activeProduct || !selectedVariant) return;
    clearCart();
    addItem(
      {
        id: activeProduct.id,
        name: activeProduct.name,
        images: activeProduct.images,
        imageUrl: primaryImageForColor(activeProduct, selectedColor) ?? undefined,
        price: activeProduct.price,
      },
      selectedVariant,
      cappedQty,
      activeProduct.batchId,
      activeProduct.batchSlug
    );
    setShowClearCartModal(false);
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
  const effectiveCampaignTitle = campaignTitle ?? products[0]?.batchName ?? null;
  const effectiveCampaignEndAt = campaignEndAt ?? products[0]?.batchEndAt ?? null;
  return (
    <div className={`glass-storefront ${styles.storefrontWrap}`}>
      {effectiveCampaignTitle && (
        <header className={styles.campaignHeader}>
          <div className={styles.campaignHeaderLeft}>
            <div className={styles.campaignBadgeRow}>
              <span className="badge badge-open">
                <span className={styles.liveDropDot} aria-hidden="true" />
                Live Pre-Order Drop
              </span>
              {effectiveCampaignEndAt && (
                <Countdown targetDate={effectiveCampaignEndAt} />
              )}
            </div>
            <h2 className={styles.campaignTitle}>{effectiveCampaignTitle}</h2>
            <p className={styles.campaignDesc}>
              {campaignDescription ||
                "Limited-run pre-order pieces. Reserve your sizes with zero upfront payment, then confirm & settle via Instagram DM."}
            </p>
            <div className={styles.howItWorksRibbon}>
              <span>1. Reserve pieces</span>
              <span aria-hidden="true">·</span>
              <span>2. Save your order ref</span>
              <span aria-hidden="true">·</span>
              <span>3. Confirm &amp; pay in IG DM</span>
            </div>
          </div>
          <a
            href={SHOP_INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.campaignDmLink}
          >
            <span>DM @{SHOP_INSTAGRAM_HANDLE}</span>
            <span className={styles.dmArrow} aria-hidden="true">↗</span>
          </a>
        </header>
      )}
      {filteredProducts.length > 1 && (
        <div className={styles.mobilePieceStrip} aria-label="Quick switch piece">
          {filteredProducts.map((p) => {
            const isSelected = p.id === activeProduct?.id;
            const thumb = primaryImageForColor(p, null);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectProduct(p, false)}
                className={`${styles.mobilePieceChip} ${isSelected ? styles.activeMobilePieceChip : ""}`}
                aria-current={isSelected ? "true" : undefined}
              >
                {thumb ? (
                  <img
                    src={imageUrlAtWidth(thumb, 400)}
                    alt=""
                    className={styles.mobilePieceThumb}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className={styles.mobilePieceThumbPlaceholder} aria-hidden="true">
                    <GarmentSilhouette category={p.category} name={p.name} size={14} />
                  </span>
                )}
                <span className={styles.mobilePieceName}>{p.name}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className={styles.splitLayout}>
        <div className={styles.highlightCol}>
          {activeProduct && (
            <div
              ref={showcaseRef}
              className={styles.showcaseStage}
            >
              {/* 1. Floating Product Stage (Top - Floating freely, No Box!) */}
              <div className={`${styles.mediaFrame} ${isFlipping ? styles.isFlipping : ""}`}>
                <div className={styles.pedestalGlow} />
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
                {gallery[safeHeroIndex] ? (
                  <div className={styles.floatingMediaWrap}>
                    <div
                      className={`${styles.floatingImgContainer} ${
                        isFlipping
                          ? flipDirection === "forward"
                            ? styles.flipForward
                            : styles.flipBackward
                          : styles.levitate
                      }`}
                    >
                      <button
                        type="button"
                        className={styles.imageZoomBtn}
                        onClick={() => {
                          if (!isFlipping) setLightboxOpen(true);
                        }}
                        aria-label={`View larger image of ${activeProduct.name}${selectedColor ? ` in ${selectedColor}` : ""}`}
                        title="Click for a wider view"
                      >
                        <img
                          src={gallery[safeHeroIndex]}
                          alt={activeProduct.name}
                          className={styles.showcaseImg}
                          srcSet={imageSrcSet(gallery[safeHeroIndex])}
                          sizes={HERO_SIZES}
                          width={HERO_WIDTH}
                          height={HERO_HEIGHT}
                          decoding="async"
                          fetchPriority="high"
                        />
                      </button>
                    </div>
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

              {/* Gallery Thumbnails positioned beneath the floating garment */}
              {gallery.length > 1 && (
                <div className={styles.thumbnailDock}>
                  {gallery.map((img, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHeroImageIndex(idx);
                      }}
                      className={`${styles.thumbBtn} ${idx === safeHeroIndex ? styles.activeThumb : ""}`}
                      aria-label={`Show image ${idx + 1}`}
                      aria-current={idx === safeHeroIndex}
                    >
                      <img
                        src={imageUrlAtWidth(img, 400)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </button>
                  ))}
                </div>
              )}

              {/* 2. Product Information Card (Below the floating product) */}
              <div className={`${styles.showcaseCard} ${highlightPulse ? styles.showcasePulse : ""}`}>
                <div className={styles.showcaseBody}>
                  <div className={styles.headerRow}>
                    <div>
                      <h2 className={styles.productName}>{activeProduct.name}</h2>
                      <div className={styles.metaRow}>
                        {activeProduct.category && (
                          <span className={styles.categoryPill}>{activeProduct.category}</span>
                        )}
                        {activeProduct.batchEndAt && (
                          <div style={activeProduct.category ? { marginLeft: "8px" } : {}}>
                            <Countdown targetDate={activeProduct.batchEndAt} />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={styles.priceTag}>
                      {formatMoney(effectivePrice)}
                    </div>
                  </div>
                  <p className={styles.descText}>
                    {activeProduct.description ||
                      "Limited-run crafted pre-order piece. Reserve yours before orders close."}
                  </p>
                  {!isOrderable && (
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
                        marginBottom: "var(--space-2)",
                      }}
                    >
                      {activeProduct.preorderStatus === "COMING_SOON"
                        ? "Coming soon to pre-order"
                        : "Item currently unavailable"}
                    </div>
                  )}
                  <div className={styles.variantSection}>
                    {colors.length > 0 && (
                      <div>
                        <div className={styles.selectorLabel}>
                          <span>Color</span>
                          <span style={{ fontWeight: 600, color: selectedColor ? "rgba(255, 255, 255, 0.95)" : "#ff80a0" }}>
                            {selectedColor || "Please select a color"}
                          </span>
                        </div>
                        <div className={styles.swatchesRow} style={{ marginTop: "var(--space-1)" }}>
                          {colors.map((color) => {
                            const available = isColorAvailable(color);
                            const selectable = !isOrderable || available;
                            const swatch = getColorSwatch(color);
                            const isSelected = selectedColor === color;
                            return (
                              <button
                                key={color}
                                id={`color-${color.toLowerCase()}`}
                                type="button"
                                className={`${styles.swatchBtn} ${
                                  isSelected ? styles.selectedSwatch : ""
                                } ${!selectable ? styles.disabledSwatch : ""}`}
                                onClick={() => handleColorChange(color)}
                                aria-disabled={!selectable}
                                aria-pressed={isSelected}
                                title={color}
                              >
                                {swatch && (
                                  <span
                                    className={styles.swatchDot}
                                    style={{
                                      background: swatch.bg,
                                      border: swatch.border ? `1.5px solid ${swatch.border}` : "1.5px solid rgba(255, 255, 255, 0.25)",
                                    }}
                                  />
                                )}
                                <span className={styles.swatchName}>{color}</span>
                                {!selectable && <span className={styles.soldOutLine} aria-hidden="true" />}
                              </button>
                            );
                          })}
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
                    {isOrderable && (
                      <div className={styles.actionRow} style={{ marginTop: "var(--space-2)" }}>
                        <div className={styles.qtyBox}>
                          <button
                            type="button"
                            className={styles.qtyBtn}
                            onClick={() => setQty(Math.max(1, cappedQty - 1))}
                            aria-label="Decrease quantity"
                          >
                            −
                          </button>
                          <span className={styles.qtyVal}>{cappedQty}</span>
                          <button
                            type="button"
                            className={styles.qtyBtn}
                            onClick={() => setQty(Math.min(maxQty, cappedQty + 1))}
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
                            ? `✓ Added to Order! (${itemCount} in bag)`
                            : colors.length > 0 && !selectedColor
                            ? "Select a Color to Pre-order"
                            : selectedColor && !isColorAvailable(selectedColor)
                            ? "Sold Out"
                            : sizes.length > 0 && !selectedSize
                            ? "Select a Size to Pre-order"
                            : qtyCap <= 0
                            ? "Sold Out"
                            : `Add to Pre-Order — ${formatMoney(effectivePrice * cappedQty)}`}
                        </button>
                      </div>
                    )}
                    <DeliveryEta batchEndAt={activeProduct.batchEndAt} />
                    {availabilityInfo.label && (
                      <p
                        id="product-availability-text"
                        style={{
                          textAlign: "center",
                          fontSize: "var(--text-xs)",
                          color: availabilityInfo.isSoldOut ? "#ff8fa0" : "#86efac",
                          fontWeight: 600,
                          margin: 0,
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
              </div>
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
              // Same resolution the hero uses, so the grid and the product view
              // never disagree: a colour-photographed product with no default
              // gallery still gets a thumbnail here.
              const cardImage = primaryImageForColor(p, null);
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
                    {cardImage ? (
                      <img
                        src={imageUrlAtWidth(cardImage, 400)}
                        srcSet={imageSrcSet(cardImage)}
                        sizes={CARD_SIZES}
                        alt={p.name}
                        className={styles.smallThumbImg}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className={styles.smallPlaceholder}>
                        <GarmentSilhouette category={p.category} name={p.name} size={28} />
                      </span>
                    )}
                  </div>
                  <div className={styles.smallCardBody}>
                    <h4 className={styles.smallProductName}>{p.name}</h4>
                    {(() => {
                      const cardColors = [...new Set(p.variants.filter((v) => v.color).map((v) => v.color!))];
                      if (cardColors.length === 0) return null;
                      const shown = cardColors.slice(0, 5);
                      const extra = cardColors.length - shown.length;
                      return (
                        <div className={styles.cardSwatches} aria-label={`${cardColors.length} colors available`}>
                          {shown.map((c) => {
                            const sw = getColorSwatch(c);
                            return (
                              <span
                                key={c}
                                className={styles.cardSwatchDot}
                                title={c}
                                style={{
                                  background: sw?.bg ?? "rgba(216, 183, 140, 0.45)",
                                  borderColor: sw?.border ?? "rgba(255, 255, 255, 0.3)",
                                }}
                              />
                            );
                          })}
                          {extra > 0 && <span className={styles.cardSwatchMore}>+{extra}</span>}
                        </div>
                      );
                    })()}
                    <div className={styles.smallPriceRow}>
                      <span className={styles.smallProductPrice}>
                        {formatMoney(p.price)}
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
      {showClearCartModal && (
        <div className={styles.viewer} style={{ background: "rgba(0,0,0,0.8)", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "rgba(255, 255, 255, 0.08)", backdropFilter: "blur(32px) saturate(200%)", borderRadius: "var(--radius-2xl)", border: "1px solid rgba(255, 255, 255, 0.16)", padding: "var(--space-6)", maxWidth: "400px", margin: "var(--space-4)", textAlign: "center", zIndex: 100 }}>
            <h3 style={{ marginBottom: "var(--space-4)", fontSize: "1.25rem", fontWeight: 700, color: "#fff" }}>This is a separate pre-order</h3>
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
      {activeProduct && (
        <ProductLightbox
          isOpen={lightboxOpen}
          images={gallery}
          activeIndex={safeHeroIndex}
          productName={activeProduct.name}
          selectedColor={selectedColor}
          onClose={() => setLightboxOpen(false)}
          onIndexChange={setHeroImageIndex}
        />
      )}
    </div>
  );
}
