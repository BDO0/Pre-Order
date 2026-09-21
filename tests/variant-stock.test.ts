import { describe, expect, it } from "vitest";
import { activeVariantCount, stockSummary, variantCountLabel } from "@/lib/variant-stock";

/**
 * The number an operator decides by: whether to close a drop, whether to reorder.
 *
 * It has to survive three shapes the database genuinely produces — retired
 * variants, unlimited capacity, and a mix of both — because a wrong number here
 * is acted on rather than questioned.
 */
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
    // A variant is retired with `active: false` rather than deleted, which is why
    // the row count and the sellable count are different numbers.
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
    // The JSON a browser receives always carries `active`, but a caller that
    // builds these objects by hand should not have to remember to.
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
