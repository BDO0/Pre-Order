"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/cart";
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

interface Campaign {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  coverImage: string | null;
  status: string;
  endAt: string | null;
  products: Product[];
}

export default function CampaignPageClient({ campaign }: { campaign: Campaign }) {
  const { addItem, getItemCount, setCampaign, campaignId } = useCartStore();

  // Set campaign in store on mount / when campaign changes
  useEffect(() => {
    if (campaignId !== campaign.id) {
      setCampaign(campaign.id, campaign.slug);
    }
  }, [campaign.id, campaign.slug, campaignId, setCampaign]);

  const isClosed = campaign.status === "CLOSED";
  const itemCount = getItemCount();

  return (
    <div className={styles.page}>
      {/* Navbar */}
      <nav className="navbar">
        <div className={`container navbar-inner`}>
          <Link href="/" className="navbar-brand">ANA Clothing</Link>
          <Link href="/cart" className={styles.cartButton} id="cart-link">
            <span>🛒</span>
            {itemCount > 0 && <span className={styles.cartBadge}>{itemCount}</span>}
            <span className="hide-mobile">Cart</span>
          </Link>
        </div>
      </nav>

      {/* Campaign Header */}
      <header className={styles.header}>
        {campaign.coverImage && (
          <div className={styles.coverImage}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={campaign.coverImage} alt={campaign.name} />
            <div className={styles.coverOverlay} />
          </div>
        )}
        <div className={`container ${styles.headerContent}`}>
          <h1 className={styles.campaignTitle}>{campaign.name}</h1>
          {campaign.description && (
            <p className={styles.campaignDesc}>{campaign.description}</p>
          )}
          {campaign.endAt && !isClosed && (
            <p className={styles.campaignEnd}>
              Pre-order closes: {new Date(campaign.endAt).toLocaleDateString("en-PH", {
                month: "long", day: "numeric", year: "numeric"
              })}
            </p>
          )}
          {isClosed && (
            <div className={styles.closedBanner}>
              🔒 This pre-order campaign is now closed.
            </div>
          )}
        </div>
      </header>

      {/* Products */}
      <main className="container" style={{ paddingBlock: "var(--space-8)" }}>
        {campaign.products.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <p className="empty-state-title">No Products Yet</p>
            <p className="empty-state-text">Products for this campaign will be listed here soon.</p>
          </div>
        ) : (
          <>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Available Products</h2>
              <p className={styles.sectionSubtitle}>{campaign.products.length} item{campaign.products.length !== 1 ? "s" : ""}</p>
            </div>
            <div className="product-grid">
              {campaign.products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  campaignId={campaign.id}
                  isCampaignClosed={isClosed}
                  onAddToCart={addItem}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* Floating cart button on mobile */}
      {itemCount > 0 && (
        <div className={styles.floatingCart}>
          <Link href="/cart" className="btn btn-primary btn-lg">
            View Order ({itemCount} item{itemCount !== 1 ? "s" : ""}) →
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Product Card ──────────────────────────────────────────────

function ProductCard({
  product,
  campaignId,
  isCampaignClosed,
  onAddToCart,
}: {
  product: Product;
  campaignId: string;
  isCampaignClosed: boolean;
  onAddToCart: (p: {id:string; name:string; images:string[]; price:number}, v: Variant, q: number) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const isOrderable = !isCampaignClosed && product.preorderStatus === "OPEN";

  const statusBadge = {
    OPEN: <span className="badge badge-open">● Available</span>,
    COMING_SOON: <span className="badge badge-coming">⏳ Coming Soon</span>,
    SOLD_OUT: <span className="badge badge-sold-out">✗ Sold Out</span>,
    CLOSED: <span className="badge badge-closed">Closed</span>,
    DISABLED: null,
  }[product.preorderStatus];

  return (
    <>
      <div className={`card ${styles.productCard} ${!isOrderable ? styles.unavailable : ""}`}>
        <div className={styles.productImage}>
          {product.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.images[0]} alt={product.name} loading="lazy" />
          ) : (
            <div className={styles.imagePlaceholder}>👗</div>
          )}
          {statusBadge && <div className={styles.statusBadge}>{statusBadge}</div>}
        </div>
        <div className="card-body">
          <h3 className={styles.productName}>{product.name}</h3>
          <p className={styles.productPrice}>
            ₱{Number(product.price).toLocaleString()}
          </p>
          {product.preorderRemaining !== null && product.preorderStatus === "OPEN" && (
            <p className={styles.remaining}>
              {product.preorderRemaining} slots left
            </p>
          )}
          {isOrderable ? (
            <button
              id={`add-to-order-${product.id}`}
              className="btn btn-primary btn-full"
              style={{ marginTop: "var(--space-3)" }}
              onClick={() => setShowPicker(true)}
            >
              Add to Order
            </button>
          ) : (
            <button className="btn btn-secondary btn-full" disabled style={{ marginTop: "var(--space-3)" }}>
              {product.preorderStatus === "COMING_SOON" ? "Coming Soon" : "Unavailable"}
            </button>
          )}
        </div>
      </div>

      {showPicker && (
        <VariantPicker
          product={product}
          onClose={() => setShowPicker(false)}
          onAdd={(variant, qty) => {
            onAddToCart(
              { id: product.id, name: product.name, images: product.images, price: product.price },
              variant,
              qty
            );
            setShowPicker(false);
          }}
        />
      )}
    </>
  );
}

// ── Variant Picker Modal ──────────────────────────────────────

function VariantPicker({
  product,
  onClose,
  onAdd,
}: {
  product: Product;
  onClose: () => void;
  onAdd: (variant: Variant, qty: number) => void;
}) {
  const colors = [...new Set(product.variants.filter(v => v.color).map(v => v.color!))];
  const sizes = [...new Set(product.variants.filter(v => v.size).map(v => v.size!))];

  const [selectedColor, setSelectedColor] = useState<string | null>(colors[0] ?? null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const selectedVariant = product.variants.find(
    v => v.color === selectedColor && v.size === selectedSize
  ) ?? (colors.length === 0 && sizes.length === 0 ? product.variants[0] : null);

  const isVariantAvailable = (color: string | null, size: string | null) => {
    const v = product.variants.find(v => v.color === color && v.size === size);
    if (!v || !v.active) return false;
    if (v.remainingCapacity !== null && v.remainingCapacity <= 0) return false;
    return true;
  };

  const canAdd = selectedVariant && selectedVariant.active &&
    (selectedVariant.remainingCapacity === null || selectedVariant.remainingCapacity >= qty);

  const handleAdd = () => {
    if (!selectedVariant || !canAdd) return;
    onAdd(selectedVariant, qty);
    setAdded(true);
    setTimeout(onClose, 800);
  };

  const effectivePrice = selectedVariant?.priceOverride
    ? Number(selectedVariant.priceOverride)
    : Number(product.price);

  return (
    <div className={styles.modalOverlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Select variant">
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose} aria-label="Close">✕</button>

        <div className={styles.modalProduct}>
          <div className={styles.modalImage}>
            {product.images[0]
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={product.images[0]} alt={product.name} />
              : <div className={styles.imagePlaceholder}>👗</div>
            }
          </div>
          <div>
            <h3 className={styles.modalTitle}>{product.name}</h3>
            <p className={styles.modalPrice}>₱{effectivePrice.toLocaleString()}</p>
          </div>
        </div>

        {colors.length > 0 && (
          <div className="form-group" style={{ marginBottom: "var(--space-4)" }}>
            <label className="form-label">Color</label>
            <div className={styles.variantOptions}>
              {colors.map(color => (
                <button
                  key={color}
                  id={`color-${color.toLowerCase()}`}
                  className={`${styles.variantBtn} ${selectedColor === color ? styles.selected : ""}`}
                  onClick={() => { setSelectedColor(color); setSelectedSize(null); }}
                >
                  {color}
                </button>
              ))}
            </div>
          </div>
        )}

        {sizes.length > 0 && (
          <div className="form-group" style={{ marginBottom: "var(--space-4)" }}>
            <label className="form-label">Size</label>
            <div className={styles.variantOptions}>
              {sizes.map(size => {
                const available = isVariantAvailable(selectedColor, size);
                return (
                  <button
                    key={size}
                    id={`size-${size.toLowerCase()}`}
                    className={`${styles.variantBtn} ${selectedSize === size ? styles.selected : ""} ${!available ? styles.disabledVariant : ""}`}
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

        <div className="form-group" style={{ marginBottom: "var(--space-6)" }}>
          <label className="form-label">Quantity</label>
          <div className={styles.qtyControl}>
            <button className={styles.qtyBtn} onClick={() => setQty(q => Math.max(1, q - 1))} aria-label="Decrease quantity">−</button>
            <span className={styles.qtyValue}>{qty}</span>
            <button
              className={styles.qtyBtn}
              onClick={() => {
                const max = selectedVariant?.remainingCapacity ?? 99;
                setQty(q => Math.min(max, q + 1));
              }}
              aria-label="Increase quantity"
            >+</button>
          </div>
        </div>

        <button
          id="confirm-add-to-order"
          className={`btn btn-primary btn-full btn-lg ${added ? styles.addedBtn : ""}`}
          onClick={handleAdd}
          disabled={!canAdd || added}
        >
          {added ? "✓ Added!" : `Add to Order — ₱${(effectivePrice * qty).toLocaleString()}`}
        </button>
      </div>
    </div>
  );
}
