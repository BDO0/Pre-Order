import { describe, expect, it } from "vitest";
import {
  nextRemainingCapacity,
  planVariantSync,
  variantKey,
  type StoredVariant,
} from "@/lib/product-variants";

// The bugs these tests exist for, all three in the old `deleteMany` + `createMany`
// variant sync in `PATCH /api/admin/products/[id]`:
//
//  1. Deleting a variant that an order refers to throws (P2003: the foreign key
//     from `order_items.variantId` has no cascade), so saving the sizes of a
//     product that had ever been ordered failed.
//  2. Every recreated variant was written with `remainingCapacity = capacity`,
//     so saving a product refilled the stock its orders had consumed.
//  3. `variants.length > 0` meant an empty list was silently ignored, while the
//     form told the operator the sizes would be replaced.
//
// The sync is pure and returns a plan, so every case below is asserted without a
// database.

/** A stored variant with the fields the sync reads, and sane defaults. */
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
    // 150 capacity with 144 left means 6 units are out with orders. Raising the
    // capacity to 200 admits 50 more units, not 200.
    expect(nextRemainingCapacity(150, 144, 200)).toBe(194);
  });

  it("keeps a reduced capacity consistent with what has already been sold", () => {
    expect(nextRemainingCapacity(150, 144, 148)).toBe(142);
  });

  it("starts a variant that had no capacity from the live order count", () => {
    // An unlimited variant has no stored pair to measure consumption from, so the
    // caller passes the units that live orders are holding - the same number
    // `npm run db:check` reconciles against.
    expect(nextRemainingCapacity(null, null, 20, 6)).toBe(14);
    expect(nextRemainingCapacity(null, null, 20, 0)).toBe(20);
  });

  it("treats null as unlimited, in both directions", () => {
    // `capacity` and `remainingCapacity` are both set or both NULL; a half-null
    // row is one of the invariants `db:check` fails on.
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
    // The form manages sizes and colours, never capacity. Every save used to
    // rewrite the counter, which both refilled the stock and lost the limit.
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
    // Putting a size back is an undo, not a new variant: the id it keeps is the id
    // its past orders point at.
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
    // 10 units sold cannot be squared with a capacity of 3: `capacity -
    // remainingCapacity` would stop matching the live order items, which is what
    // db:check reconciles. Refused rather than clamped, so nothing is written.
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
    // One row per size, one variant: two rows for the same size and colour would
    // otherwise fight over the same stored variant. The later row wins.
    const plan = planVariantSync([], [{ size: "M" }, { size: "m", capacity: 5 }]);

    expect(plan.create).toEqual([{ size: "m", color: null, capacity: 5 }]);
  });

  it("keeps the oldest row when the same variant is stored twice", () => {
    // Nothing prevents a duplicate: there is no unique index on
    // (productId, size, color). The oldest keeps the identity, so its orders stay
    // attached; the extra row is retired rather than left holding a second,
    // invisible stock counter.
    const plan = planVariantSync(
      [stored({ id: "older" }), stored({ id: "newer" })],
      [{ size: "M" }]
    );

    expect(plan.deactivate).toEqual(["newer"]);
    expect(plan.update).toEqual([]);
  });

  it("says nothing about a variant that was already retired and is still absent", () => {
    // Retiring an already-retired variant would put a no-op write and a misleading
    // "1 size retired" in the response on every subsequent save.
    const plan = planVariantSync(
      [stored({ id: "v-s", size: "S", active: false })],
      [{ size: "M" }]
    );

    expect(plan.deactivate).toEqual([]);
    expect(plan.create).toEqual([{ size: "M", color: null, capacity: null }]);
  });
});
