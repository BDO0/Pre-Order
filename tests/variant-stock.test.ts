import { describe, expect, it } from "vitest";
import {
  activeVariantCount,
  stockSummary,
  variantCountLabel,
  getProductAvailabilityOverview,
  colorHexHint,
  buildProductListingSummary,
} from "@/lib/variant-stock";


describe("stockSummary", () => {
  it("adds up the capped variants", () => {
    expect(
      stockSummary([
        { capacity: 10, remainingCapacity: 4 },
        { capacity: 5, remainingCapacity: 0 },
      ])
    ).toBe("4 / 15");
  });

  it("leaves retired variants out, because nobody can buy them", () => {
    expect(
      stockSummary([
        { capacity: 10, remainingCapacity: 4, active: true },
        { capacity: 100, remainingCapacity: 100, active: false },
      ])
    ).toBe("4 / 10");
  });

  it("says unlimited rather than 0 / 0 when nothing is capped", () => {
    expect(stockSummary([{ capacity: null, remainingCapacity: null }])).toBe("unlimited");
    expect(stockSummary([])).toBe("—");
    expect(stockSummary(undefined)).toBe("—");
  });

  it("names the uncapped variants alongside the capped total", () => {
    expect(
      stockSummary([
        { capacity: 10, remainingCapacity: 4 },
        { capacity: null, remainingCapacity: null },
        { capacity: null, remainingCapacity: null },
      ])
    ).toBe("4 / 10 (+2 unlimited)");
  });

  it("treats a missing active flag as active", () => {
    expect(stockSummary([{ capacity: 2, remainingCapacity: 2 }])).toBe("2 / 2");
  });
});

describe("activeVariantCount", () => {
  it("counts only the variants a shopper can choose", () => {
    expect(
      activeVariantCount([
        { active: true },
        { active: false },
        { active: true },
      ])
    ).toBe(2);
    expect(activeVariantCount(undefined)).toBe(0);
  });
});

describe("variantCountLabel", () => {
  it("reads as English for one and for many", () => {
    expect(variantCountLabel([{ active: true }])).toBe("1 variant");
    expect(variantCountLabel([{ active: true }, { active: true }])).toBe("2 variants");
    expect(variantCountLabel([])).toBe("0 variants");
  });
});

describe("getProductAvailabilityOverview", () => {
  it("computes color and size breakdowns correctly", () => {
    const variants = [
      { color: "Black", size: "S", capacity: 10, remainingCapacity: 5, active: true },
      { color: "Black", size: "M", capacity: 10, remainingCapacity: 2, active: true },
      { color: "White", size: "S", capacity: 5, remainingCapacity: 0, active: true },
      { color: "White", size: "M", capacity: 5, remainingCapacity: 1, active: true },
      { color: "Red", size: "L", capacity: 20, remainingCapacity: 20, active: false }, // inactive
    ];

    const overview = getProductAvailabilityOverview(variants);

    expect(overview.totalVariants).toBe(5);
    expect(overview.activeVariants).toBe(4);
    expect(overview.totalRemaining).toBe(8); // 5 + 2 + 0 + 1
    expect(overview.totalCapacity).toBe(30); // 10 + 10 + 5 + 5

    // Colors
    expect(overview.colors.length).toBe(2);
    const black = overview.colors.find((c) => c.name === "Black");
    expect(black).toBeDefined();
    expect(black?.remaining).toBe(7);
    expect(black?.capacity).toBe(20);
    expect(black?.isSoldOut).toBe(false);
    expect(black?.pairedOptions).toEqual(["S", "M"]);

    const white = overview.colors.find((c) => c.name === "White");
    expect(white).toBeDefined();
    expect(white?.remaining).toBe(1);
    expect(white?.isLowStock).toBe(true);
    expect(white?.pairedOptions).toEqual(["S", "M"]);

    // Sizes
    expect(overview.sizes.length).toBe(2);
    const sizeS = overview.sizes.find((s) => s.name === "S");
    expect(sizeS?.remaining).toBe(5);
    expect(sizeS?.pairedOptions).toEqual(["Black", "White"]);
  });

  it("handles empty and sold out sets", () => {
    expect(getProductAvailabilityOverview([])).toMatchObject({
      activeVariants: 0,
      isSoldOut: true,
      colors: [],
      sizes: [],
    });

    const soldOut = getProductAvailabilityOverview([
      { color: "Navy", size: "M", capacity: 5, remainingCapacity: 0, active: true },
    ]);
    expect(soldOut.isSoldOut).toBe(true);
    expect(soldOut.colors[0].isSoldOut).toBe(true);
    expect(soldOut.summaryText).toBe("Sold Out");
  });

  it("handles unlimited variants gracefully", () => {
    const overview = getProductAvailabilityOverview([
      { color: "Blue", size: "XL", capacity: null, remainingCapacity: null, active: true },
    ]);
    expect(overview.hasUnlimited).toBe(true);
    expect(overview.colors[0].isUnlimited).toBe(true);
    expect(overview.summaryText).toBe("Unlimited availability");
  });
});

describe("colorHexHint", () => {
  it("resolves recognized colors to hex", () => {
    expect(colorHexHint("black")).toBe("#171717");
    expect(colorHexHint("Red")).toBe("#ef4444");
    expect(colorHexHint("Sky Blue")).toBe("#38bdf8");
  });

  it("returns null for unknown or empty colors", () => {
    expect(colorHexHint(null)).toBeNull();
    expect(colorHexHint("CustomPattern123")).toBeNull();
  });
});

describe("buildProductListingSummary", () => {
  it("formats full product listing summary with variants, colors, and order link", () => {
    const variants = [
      { color: "Black", size: "S", capacity: 10, remainingCapacity: 5, active: true },
      { color: "Black", size: "M", capacity: 10, remainingCapacity: 0, active: true },
      { color: "White", size: "S", capacity: 5, remainingCapacity: 3, active: true },
    ];
    const overview = getProductAvailabilityOverview(variants);
    const summary = buildProductListingSummary(
      {
        name: "Premium Cotton Tee",
        slug: "premium-cotton-tee",
        category: "Apparel",
        price: 850,
        preorderStatus: "OPEN",
        variants,
      },
      overview,
      "https://example.com"
    );

    expect(summary).toContain("🛍️ Premium Cotton Tee");
    expect(summary).toContain("📁 Category: Apparel");
    expect(summary).toContain("💰 Price: ₱850");
    expect(summary).toContain("📦 Status: Open for Pre-Order");
    expect(summary).toContain("📊 Stock Overview: 8 / 25 available");
    expect(summary).toContain("🎨 Available Colors:");
    expect(summary).toContain("  • Black: 5 left");
    expect(summary).toContain("  • White: 3 left");
    expect(summary).toContain("📏 Available Sizes:");
    expect(summary).toContain("  • S: 8 left");
    expect(summary).toContain("  • M: Sold Out");
    expect(summary).toContain("📋 Variant Breakdown:");
    expect(summary).toContain("  • Black / S — 5 available");
    expect(summary).toContain("  • Black / M — Sold Out");
    expect(summary).toContain("  • White / S — 3 available");
    expect(summary).toContain("🔗 Pre-Order Link: https://example.com/preorder/premium-cotton-tee");
  });

  it("handles products with no variants gracefully", () => {
    const overview = getProductAvailabilityOverview([]);
    const summary = buildProductListingSummary(
      {
        name: "Minimalist Cap",
        slug: "minimalist-cap",
        price: 499,
        preorderStatus: "COMING_SOON",
      },
      overview
    );

    expect(summary).toContain("🛍️ Minimalist Cap");
    expect(summary).toContain("💰 Price: ₱499");
    expect(summary).toContain("📦 Status: Coming Soon");
    expect(summary).toContain("📊 Stock Overview: No variants");
    expect(summary).not.toContain("🎨 Available Colors:");
    expect(summary).not.toContain("📏 Available Sizes:");
    expect(summary).toContain("🔗 Pre-Order Link: /preorder/minimalist-cap");
  });
});


