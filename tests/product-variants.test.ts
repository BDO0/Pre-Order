import { describe, expect, it } from "vitest";
import {
  nextRemainingCapacity,
  planVariantSync,
  variantKey,
  type StoredVariant,
} from "@/lib/product-variants";


function stored(overrides: Partial<StoredVariant> & { id: string }): StoredVariant {
  return {
    size: "M",
    color: null,
    capacity: null,
    remainingCapacity: null,
    active: true,
    ...overrides,
  };
}

describe("nextRemainingCapacity", () => {
  it("subtracts what has already been sold, so a capacity change cannot refill stock", () => {
    expect(nextRemainingCapacity(150, 144, 200)).toBe(194);
  });

  it("keeps a reduced capacity consistent with what has already been sold", () => {
    expect(nextRemainingCapacity(150, 144, 148)).toBe(142);
  });

  it("starts a variant that had no capacity from the live order count", () => {
    expect(nextRemainingCapacity(null, null, 20, 6)).toBe(14);
    expect(nextRemainingCapacity(null, null, 20, 0)).toBe(20);
  });

  it("treats null as unlimited, in both directions", () => {
    expect(nextRemainingCapacity(150, 144, null)).toBeNull();
    expect(nextRemainingCapacity(null, null, null)).toBeNull();
  });
});

describe("variantKey", () => {
  it("ignores case and surrounding space", () => {
    expect(variantKey(" m ", "Black")).toBe(variantKey("M", "black"));
  });

  it("treats an empty size and a missing one as the same variant", () => {
    expect(variantKey("", null)).toBe(variantKey(null, undefined));
  });
});

describe("planVariantSync", () => {
  it("retires the variants that left the list instead of deleting them", () => {
    const plan = planVariantSync(
      [stored({ id: "v-s", size: "S" }), stored({ id: "v-m", size: "M" })],
      [{ size: "M" }]
    );

    expect(plan.deactivate).toEqual(["v-s"]);
    expect(plan.update).toEqual([]);
    expect(plan.create).toEqual([]);
  });

  it("does not touch a stock counter when the request carries no capacity", () => {
    const plan = planVariantSync(
      [stored({ id: "v-m", capacity: 150, remainingCapacity: 144 })],
      [{ size: "M" }]
    );

    expect(plan.update).toEqual([]);
  });

  it("reads an empty list as 'no sizes at all'", () => {
    const plan = planVariantSync(
      [stored({ id: "v-s", size: "S" }), stored({ id: "v-m", size: "M" })],
      []
    );

    expect(plan.deactivate).toEqual(["v-s", "v-m"]);
  });

  it("brings a retired size back with the same id and the stock it had", () => {
    const plan = planVariantSync(
      [stored({ id: "v-m", capacity: 10, remainingCapacity: 4, active: false })],
      [{ size: "M" }]
    );

    expect(plan.update).toEqual([{ id: "v-m", capacity: 10, remainingCapacity: 4 }]);
    expect(plan.create).toEqual([]);
  });

  it("creates only the variants that are genuinely new", () => {
    const plan = planVariantSync(
      [stored({ id: "v-m", size: "M" })],
      [{ size: "M" }, { size: "L" }]
    );

    expect(plan.create).toEqual([{ size: "L", color: null, capacity: null }]);
    expect(plan.update).toEqual([]);
  });

  it("refuses a capacity below what has already been ordered", () => {
    const plan = planVariantSync(
      [stored({ id: "v-m", capacity: 10, remainingCapacity: 0 })],
      [{ size: "M", capacity: 3 }]
    );

    expect(plan.conflicts).toEqual([{ size: "M", color: null, requested: 3, consumed: 10 }]);
    expect(plan.update).toEqual([]);
  });

  it("uses the live order count when a capacity is set for the first time", () => {
    const plan = planVariantSync(
      [stored({ id: "v-m" })],
      [{ size: "M", capacity: 20 }],
      new Map([["v-m", 6]])
    );

    expect(plan.update).toEqual([{ id: "v-m", capacity: 20, remainingCapacity: 14 }]);
  });

  it("writes each identity once, even when a request repeats it", () => {
    const plan = planVariantSync([], [{ size: "M" }, { size: "m", capacity: 5 }]);

    expect(plan.create).toEqual([{ size: "m", color: null, capacity: 5 }]);
  });

  it("keeps the oldest row when the same variant is stored twice", () => {
    const plan = planVariantSync(
      [stored({ id: "older" }), stored({ id: "newer" })],
      [{ size: "M" }]
    );

    expect(plan.deactivate).toEqual(["newer"]);
    expect(plan.update).toEqual([]);
  });

  it("says nothing about a variant that was already retired and is still absent", () => {
    const plan = planVariantSync(
      [stored({ id: "v-s", size: "S", active: false })],
      [{ size: "M" }]
    );

    expect(plan.deactivate).toEqual([]);
    expect(plan.create).toEqual([{ size: "M", color: null, capacity: null }]);
  });
});
