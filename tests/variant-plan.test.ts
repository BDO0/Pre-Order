import { describe, expect, it } from "vitest";
import {
  buildVariantMatrix,
  buildVariantPayload,
  describeRetirements,
  describeVariant,
  expandVariantPayload,
  parseCapacityInput,
  parseVariantList,
  planVariantSync,
  variantKey,
  MAX_VARIANTS,
  type StoredVariant,
} from "@/lib/variant-plan";
import { productUpdateSchema } from "@/lib/validation";


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

  it("splits on comma, semicolon, full-width comma, and newlines", () => {
    expect(parseVariantList("Black, Red, Blue")).toEqual(["Black", "Red", "Blue"]);
    expect(parseVariantList("Black; Red; Blue")).toEqual(["Black", "Red", "Blue"]);
    expect(parseVariantList("Black，Red，Blue")).toEqual(["Black", "Red", "Blue"]);
    expect(parseVariantList("Black\nRed\nBlue")).toEqual(["Black", "Red", "Blue"]);
    expect(parseVariantList(null)).toEqual([]);
    expect(parseVariantList(undefined)).toEqual([]);
  });

  it("folds case for the comparison only, keeping the spelling typed first", () => {
    expect(parseVariantList("Black, black, BLACK")).toEqual(["Black"]);
  });

  it("uses the same identity the sync uses, so the grid and the rows agree", () => {
    expect(variantKey(" m ", "Black")).toBe(variantKey("M", "black"));
    expect(variantKey("", null)).toBe(variantKey(null, undefined));
  });
});

describe("expandVariantPayload", () => {
  it("expands a single variant with comma-separated colors into multiple distinct variants", () => {
    const raw = [{ color: "Black, Red, Blue", size: "M", capacity: 10 }];
    expect(expandVariantPayload(raw)).toEqual([
      { color: "Black", size: "M", capacity: 10 },
      { color: "Red", size: "M", capacity: 10 },
      { color: "Blue", size: "M", capacity: 10 },
    ]);
  });

  it("expands comma-separated sizes and colors across all combinations", () => {
    const raw = [{ color: "Black, White", size: "S, M", capacity: 5 }];
    expect(expandVariantPayload(raw)).toEqual([
      { color: "Black", size: "S", capacity: 5 },
      { color: "Black", size: "M", capacity: 5 },
      { color: "White", size: "S", capacity: 5 },
      { color: "White", size: "M", capacity: 5 },
    ]);
  });

  it("leaves already-distinct variants untouched", () => {
    const raw = [
      { color: "Black", size: "S", capacity: 10 },
      { color: "White", size: "S", capacity: 10 },
    ];
    expect(expandVariantPayload(raw)).toEqual(raw);
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
    expect(buildVariantMatrix([], ["Black"])).toEqual([{ size: null, color: "Black" }]);
    expect(buildVariantMatrix(["M"], [])).toEqual([{ size: "M", color: null }]);
  });

  it("is an empty list only when both boxes are empty", () => {
    expect(buildVariantMatrix([], [])).toEqual([]);
  });
});

describe("the colour that used to disappear", () => {
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
    expect(planVariantSync(existing, incoming).update).toEqual([]);
  });

  it("still retires a colour the operator actually removed", () => {
    const incoming = buildVariantMatrix(parseVariantList("S, M"), parseVariantList("Black"));

    expect(describeRetirements(existing, incoming)).toEqual(["White / S", "White / M"]);
  });

  it("names an option the way the operator typed it", () => {
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

    expect(describeRetirements(withRetired, incoming)).toEqual([]);
  });

  it("puts a size back with the stock it was holding", () => {
    const sold: StoredVariant[] = [
      stored({ id: "v6", size: "M", color: "Black", capacity: 30, remainingCapacity: 22, active: false }),
    ];

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


