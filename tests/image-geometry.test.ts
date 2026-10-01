import { describe, expect, it } from "vitest";
import {
  CARD_SIZES,
  HERO_HEIGHT,
  HERO_SIZES,
  HERO_WIDTH,
  IMAGE_WIDTHS,
  heightForWidth,
  imageFilename,
  imageSrcSet,
  imageUrlAtWidth,
} from "@/lib/image-geometry";

// The storefront derives every image URL from the single URL stored on the
// product record. If these conventions drift, the <img> srcset points at files
// the upload route never wrote, and the browser silently falls back to a 404 or
// the full-size master. That failure is invisible in review, so it is pinned.
describe("hero geometry", () => {
  it("is a 4:5 portrait frame", () => {
    expect(HERO_WIDTH / HERO_HEIGHT).toBeCloseTo(0.8, 5);
  });

  it("keeps every derivative inside the same frame", () => {
    expect(heightForWidth(400)).toBe(500);
    expect(heightForWidth(800)).toBe(1000);
    expect(heightForWidth(HERO_WIDTH)).toBe(HERO_HEIGHT);
  });

  it("contains the canonical width, so the widest rung is what gets stored", () => {
    // The upload route stores imageFilename(base, HERO_WIDTH) and derives the
    // rest from it. If HERO_WIDTH were ever dropped from the ladder, every other
    // rung would be unreachable.
    expect(IMAGE_WIDTHS).toContain(HERO_WIDTH);
    expect(Math.max(...IMAGE_WIDTHS)).toBe(HERO_WIDTH);
  });
});

describe("imageFilename", () => {
  it("names each rung from one base", () => {
    expect(imageFilename("9f3c", 400)).toBe("9f3c-400.webp");
    expect(imageFilename("9f3c", HERO_WIDTH)).toBe("9f3c-1320.webp");
  });
});

describe("imageSrcSet", () => {
  it("derives the ladder from the canonical URL", () => {
    expect(imageSrcSet("/uploads/9f3c-1320.webp")).toBe(
      "/uploads/9f3c-400.webp 400w, /uploads/9f3c-800.webp 800w, /uploads/9f3c-1320.webp 1320w"
    );
  });

  it("works for object storage URLs without touching the host", () => {
    const url = "https://x.supabase.co/storage/v1/object/public/products/ab-1320.webp";
    expect(imageSrcSet(url)).toBe(
      "https://x.supabase.co/storage/v1/object/public/products/ab-400.webp 400w, " +
        "https://x.supabase.co/storage/v1/object/public/products/ab-800.webp 800w, " +
        "https://x.supabase.co/storage/v1/object/public/products/ab-1320.webp 1320w"
    );
  });

  it("returns undefined for anything that is not a ladder", () => {
    // An image stored before the ladder existed has no siblings on disk, so a
    // srcset for it would make the browser choose a file that is not there.
    for (const value of ["/uploads/9f3c.webp", "/api/og/site", "", null, undefined]) {
      expect(imageSrcSet(value)).toBeUndefined();
    }
  });

  it("only treats the widest rung as canonical", () => {
    expect(imageSrcSet("/uploads/9f3c-800.webp")).toBeUndefined();
  });

  it("fails closed when the suffix is not the end of the URL", () => {
    // A cache-buster would break derivation; falling back to `src` alone is the
    // safe direction, never a srcset pointing at a URL that does not exist.
    expect(imageSrcSet("/uploads/9f3c-1320.webp?v=2")).toBeUndefined();
  });
});

describe("imageUrlAtWidth", () => {
  it("rewrites the rung and keeps the prefix", () => {
    expect(imageUrlAtWidth("/uploads/9f3c-1320.webp", 400)).toBe("/uploads/9f3c-400.webp");
  });

  it("falls back to the original for pre-ladder images", () => {
    expect(imageUrlAtWidth("/uploads/9f3c.webp", 400)).toBe("/uploads/9f3c.webp");
  });
});

describe("sizes hints", () => {
  it("are non-empty CSS lengths", () => {
    for (const hint of [HERO_SIZES, CARD_SIZES]) {
      expect(hint.length).toBeGreaterThan(0);
      expect(hint).toContain("px");
    }
  });
});
