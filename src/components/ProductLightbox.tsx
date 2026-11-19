"use client";

import { useEffect } from "react";
import { imageSrcSet, imageUrlAtWidth } from "@/lib/image-geometry";
import styles from "./ProductLightbox.module.css";

interface ProductLightboxProps {
  isOpen: boolean;
  images: readonly string[];
  activeIndex: number;
  productName: string;
  selectedColor?: string | null;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

/**
 * Full-screen wider preview for a product or selected colourway.
 * Lets shoppers inspect details at full 1320w resolution (with pinch-zoom on
 * touch devices) without altering the surrounding showcase layout.
 */
export function ProductLightbox({
  isOpen,
  images,
  activeIndex,
  productName,
  selectedColor,
  onClose,
  onIndexChange,
}: ProductLightboxProps) {
  const count = images.length;
  const safeIndex = count > 0 ? Math.min(Math.max(0, activeIndex), count - 1) : 0;

  useEffect(() => {
    if (!isOpen || count === 0) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" && count > 1) {
        onIndexChange((safeIndex - 1 + count) % count);
      } else if (e.key === "ArrowRight" && count > 1) {
        onIndexChange((safeIndex + 1) % count);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, count, safeIndex, onClose, onIndexChange]);

  if (!isOpen || count === 0) return null;

  const currentUrl = images[safeIndex];
  const label = selectedColor ? `${productName} — ${selectedColor}` : productName;

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`${label} larger preview`}
      onClick={onClose}
    >
      <div className={styles.topBar} onClick={(e) => e.stopPropagation()}>
        <div className={styles.titleMeta}>
          <p className={styles.productTitle}>{productName}</p>
          {selectedColor && <span className={styles.colorBadge}>{selectedColor}</span>}
          {count > 1 && (
            <span className={styles.counter}>
              {safeIndex + 1} / {count}
            </span>
          )}
        </div>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close larger preview"
          title="Close (Esc)"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className={styles.stage} onClick={onClose}>
        {count > 1 && (
          <button
            type="button"
            className={styles.navBtnLeft}
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange((safeIndex - 1 + count) % count);
            }}
            aria-label="Previous image"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}

        <div className={styles.imgFrame} onClick={(e) => e.stopPropagation()}>
          <img
            src={imageUrlAtWidth(currentUrl, 1320)}
            srcSet={imageSrcSet(currentUrl)}
            sizes="(max-width: 768px) 96vw, 88vw"
            alt={label}
            className={styles.lightboxImg}
            decoding="async"
          />
        </div>

        {count > 1 && (
          <button
            type="button"
            className={styles.navBtnRight}
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange((safeIndex + 1) % count);
            }}
            aria-label="Next image"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
      </div>

      {count > 1 ? (
        <div className={styles.thumbStrip} onClick={(e) => e.stopPropagation()}>
          {images.map((img, idx) => (
            <button
              key={`${img}-${idx}`}
              type="button"
              className={`${styles.thumbBtn} ${idx === safeIndex ? styles.activeThumb : ""}`}
              onClick={() => onIndexChange(idx)}
              aria-label={`View image ${idx + 1}`}
              aria-current={idx === safeIndex}
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
      ) : (
        <div style={{ height: "1px" }} aria-hidden="true" />
      )}
    </div>
  );
}
