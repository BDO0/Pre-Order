import { describe, expect, it } from "vitest";
import { activeVariantCount, stockSummary, variantCountLabel } from "@/lib/variant-stock";

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
