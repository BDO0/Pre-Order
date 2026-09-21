import { describe, expect, it } from "vitest";
import {
  buildVariantMatrix,
  buildVariantPayload,
  describeRetirements,
  describeVariant,
  parseCapacityInput,
  parseVariantList,
  planVariantSync,
  variantKey,
  MAX_VARIANTS,
  type StoredVariant,
} from "@/lib/variant-plan";
import { productUpdateSchema } from "@/lib/validation";

// The product screens had two bugs, and the worse one was silent:
//
//  1. The edit form rebuilt the variant list from a single colour text field,
//     seeded with the colour of the product's *first* variant. A product in
//     Black and White therefore loaded with "Black" in the box, so saving it for
//     any reason - renaming it, correcting the price - retired White and every
//     one of its sizes. The screen said "Product updated successfully".
//  2. Neither screen sent `capacity` at all, so every product an operator
//     created was unlimited and the "cannot oversell" promise held only for the
//     rows `prisma/seed.ts` had written. `productUpdateSchema` did not even
//     accept the product-wide `preorderLimit`, so there was nothing to send.
//
// Both are pure functions, so both are asserted here without a database.

/** A stored variant with the fields a sync reads, and sane defaults. */
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

describe("parseVariantList", () => {
  it("splits on commas and drops what an empty entry would become", () => {
    expect(parseVariantList("S, M, L, XL")).toEqual(["S", "M", "L", "XL"]);
    expect(parseVariantList("Black,")).toEqual(["Black"]);
    expect(parseVariantList("")).toEqual([]);
    expect(parseVariantList("   ")).toEqual([]);
  });

  it("folds case for the comparison only, keeping the spelling typed first", () => {
    // `variantKey` folds case, so "Black, black" is one option to the database.
    // Collapsing it here means the grid the operator sees matches the options
    // they get, instead of showing a row that quietly vanishes on save.
    expect(parseVariantList("Black, black, BLACK")).toEqual(["Black"]);
  });

  it("uses the same identity the sync uses, so the grid and the rows agree", () => {
    expect(variantKey(" m ", "Black")).toBe(variantKey("M", "black"));
    expect(variantKey("", null)).toBe(variantKey(null, undefined));
  });
});

describe("buildVariantMatrix", () => {
  it("pairs every colour with every size, colour first", () => {
    expect(buildVariantMatrix(["S", "M"], ["Black", "White"])).toEqual([
      { size: "S", color: "Black" },
      { size: "M", color: "Black" },
      { size: "S", color: "White" },
      { size: "M", color: "White" },
    ]);
  });

  it("leaves the dimension that was not filled in as null", () => {
    // One colour and no sizes is a real product, not an empty one.
    expect(buildVariantMatrix([], ["Black"])).toEqual([{ size: null, color: "Black" }]);
    expect(buildVariantMatrix(["M"], [])).toEqual([{ size: "M", color: null }]);
  });

  it("is an empty list only when both boxes are empty", () => {
    expect(buildVariantMatrix([], [])).toEqual([]);
  });
});

describe("the colour that used to disappear", () => {
  // The product as stored: two colours, two sizes, all four on sale.
  const existing: StoredVariant[] = [
    stored({ id: "v1", size: "S", color: "Black" }),
    stored({ id: "v2", size: "M", color: "Black" }),
    stored({ id: "v3", size: "S", color: "White" }),
    stored({ id: "v4", size: "M", color: "White" }),
  ];

  it("retires nothing when the form sends back every colour it was shown", () => {
    const incoming = buildVariantMatrix(parseVariantList("S, M"), parseVariantList("Black, White"));

    expect(describeRetirements(existing, incoming)).toEqual([]);
    expect(planVariantSync(existing, incoming).deactivate).toEqual([]);
    // Nothing to write either: the grid does not carry a capacity key, so the
    // sync does not touch the stock counters of an untouched product.
    expect(planVariantSync(existing, incoming).update).toEqual([]);
  });

  it("still retires a colour the operator actually removed", () => {
    // Deleting "White" from the colour box is a real instruction, and the only
    // thing that should ever take those options off the storefront.
    const incoming = buildVariantMatrix(parseVariantList("S, M"), parseVariantList("Black"));

    expect(describeRetirements(existing, incoming)).toEqual(["White / S", "White / M"]);
  });

  it("names an option the way the operator typed it", () => {
    // This string is what the confirmation dialog shows and what the API's
    // capacity errors say: one name for one variant.
    expect(describeVariant({ size: "M", color: "Black" })).toBe("Black / M");
    expect(describeVariant({ size: null, color: "Black" })).toBe("Black");
    expect(describeVariant({ size: null, color: null })).toBe("the default variant");
  });

  it("does not warn about an option that is already retired", () => {
    const withRetired = [
      ...existing,
      stored({ id: "v5", size: "L", color: "Black", active: false }),
    ];
    const incoming = buildVariantMatrix(parseVariantList("S, M"), parseVariantList("Black, White"));

    // L / Black is already off the storefront, so there is nothing to announce.
    expect(describeRetirements(withRetired, incoming)).toEqual([]);
  });

  it("puts a size back with the stock it was holding", () => {
    const sold: StoredVariant[] = [
      stored({ id: "v6", size: "M", color: "Black", capacity: 30, remainingCapacity: 22, active: false }),
    ];

    // An option the grid stops showing - because the size left the text box - is
    // not written at all, so a retired row keeps its capacity and putting the
    // size back is undoable rather than a fresh start.
    const away = planVariantSync(sold, buildVariantMatrix(["L"], ["Black"]));
    expect(away.deactivate).toEqual([]);

    const back = planVariantSync(sold, buildVariantMatrix(["M"], ["Black"]));
    expect(back.update).toEqual([{ id: "v6", capacity: 30, remainingCapacity: 22 }]);
  });
});

describe("parseCapacityInput", () => {
  it("reads a blank box as no limit", () => {
    expect(parseCapacityInput("")).toEqual({ ok: true, capacity: null });
    expect(parseCapacityInput("   ")).toEqual({ ok: true, capacity: null });
  });

  it("accepts a whole number, with or without surrounding space", () => {
    expect(parseCapacityInput("10")).toEqual({ ok: true, capacity: 10 });
    expect(parseCapacityInput(" 7 ")).toEqual({ ok: true, capacity: 7 });
  });

  it("refuses what it cannot read instead of calling it no limit", () => {
    // The old form had no stock box at all, which is the same failure wearing a
    // different coat: what the operator typed was never what was stored.
    for (const bad of ["3o", "2.5", "0", "-5"]) {
      expect(parseCapacityInput(bad).ok, `"${bad}"`).toBe(false);
    }

    const zero = parseCapacityInput("0");
    if (!zero.ok) expect(zero.message).toContain("Leave it empty");
  });
});

describe("buildVariantPayload", () => {
  it("carries a stock box for every option", () => {
    const result = buildVariantPayload([
      { size: "S", color: "Black", capacity: "10" },
      { size: "M", color: "Black", capacity: "" },
    ]);

    expect(result).toEqual({
      ok: true,
      variants: [
        { size: "S", color: "Black", capacity: 10 },
        // Blank is sent as null rather than left out. This screen owns the stock
        // box, so an empty one means "no limit" - while a *missing* key still
        // means "leave the counter alone", which is what a save from a screen
        // that does not show stock has to say.
        { size: "M", color: "Black", capacity: null },
      ],
    });
  });

  it("says which option a bad stock box belongs to", () => {
    const result = buildVariantPayload([
      { size: "S", color: "Black", capacity: "10" },
      { size: "M", color: "White", capacity: "lots" },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("White / M");
  });

  it("refuses more options than the API will take, before sending them", () => {
    const rows = Array.from({ length: MAX_VARIANTS + 1 }, (_, index) => ({
      size: `S${index}`,
      color: null,
      capacity: "",
    }));

    const result = buildVariantPayload(rows);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(String(MAX_VARIANTS));
  });
});

describe("productUpdateSchema", () => {
  it("accepts the product-wide cap now that the edit screen sends it", () => {
    const parsed = productUpdateSchema.safeParse({
      name: "Linen Polo",
      price: 850,
      preorderLimit: 50,
      variants: [{ size: "M", color: "Black", capacity: 10 }],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.preorderLimit).toBe(50);
  });

  it("accepts no limit as null", () => {
    const parsed = productUpdateSchema.safeParse({
      name: "Linen Polo",
      price: 850,
      preorderLimit: null,
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.preorderLimit).toBeNull();
  });

  it("still refuses a cap that is not a positive whole number", () => {
    for (const preorderLimit of [0, -5, 2.5]) {
      const parsed = productUpdateSchema.safeParse({
        name: "Linen Polo",
        price: 850,
        preorderLimit,
      });

      expect(parsed.success, `preorderLimit ${preorderLimit}`).toBe(false);
    }
  });
});


