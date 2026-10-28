import { describe, expect, it } from "vitest";
import {
  buildColorImageMap,
  clearedColorLabels,
  colorHasOwnImages,
  colorImageCoverage,
  colorImageCreateRows,
  colorImageDraftsFromRows,
  colorImagePayload,
  imagesForColor,
  MAX_IMAGES_PER_COLOR,
  normalizeColorKey,
  planColorImageSync,
  primaryImageForColor,
  type StoredColorImageRow,
} from "@/lib/product-color-images";
import { isStoredImageUrl } from "@/lib/uploads";
import { productCreateSchema, productUpdateSchema } from "@/lib/validation";

function stored(overrides: Partial<StoredColorImageRow> & { id: string }): StoredColorImageRow {
  return {
    colorKey: "black",
    colorLabel: "Black",
    url: "/uploads/black-1.webp",
    sortOrder: 0,
    ...overrides,
  };
}

const product = {
  images: ["/uploads/default-1.webp", "/uploads/default-2.webp"],
  colorImages: {
    black: ["/uploads/black-1.webp", "/uploads/black-2.webp"],
    bone: ["/uploads/bone-1.webp"],
  },
};

describe("normalizeColorKey", () => {
  it("folds case and trims, so one colour has one identity", () => {
    expect(normalizeColorKey(" Black ")).toBe("black");
    expect(normalizeColorKey("BONE")).toBe(normalizeColorKey("bone"));
  });

  it("buckets a missing colour as the empty string", () => {
    expect(normalizeColorKey(null)).toBe("");
    expect(normalizeColorKey(undefined)).toBe("");
    expect(normalizeColorKey("   ")).toBe("");
  });
});

describe("buildColorImageMap", () => {
  it("orders each colour by sortOrder and keys it by the normalised label", () => {
    const map = buildColorImageMap([
      { colorKey: "Black", url: "/uploads/second.webp", sortOrder: 1 },
      { colorKey: "black", url: "/uploads/first.webp", sortOrder: 0 },
    ]);

    expect(map).toEqual({ black: ["/uploads/first.webp", "/uploads/second.webp"] });
  });

  it("drops blank and duplicate URLs instead of rendering broken tiles", () => {
    const map = buildColorImageMap([
      { colorKey: "black", url: "/uploads/a.webp", sortOrder: 0 },
      { colorKey: "black", url: "/uploads/a.webp", sortOrder: 1 },
      { colorKey: "black", url: "   ", sortOrder: 2 },
    ]);

    expect(map).toEqual({ black: ["/uploads/a.webp"] });
  });

  it("returns nothing for a product with no rows", () => {
    expect(buildColorImageMap(undefined)).toEqual({});
    expect(buildColorImageMap([])).toEqual({});
  });
});

describe("imagesForColor", () => {
  it("prefers the colour's own gallery", () => {
    expect(imagesForColor(product, "Black")).toEqual([
      "/uploads/black-1.webp",
      "/uploads/black-2.webp",
    ]);
  });

  it("falls back to the default gallery when the colour has none", () => {
    expect(imagesForColor(product, "Sand")).toEqual(product.images);
  });

  it("falls back when no colour is selected yet", () => {
    expect(imagesForColor(product, null)).toEqual(product.images);
    expect(imagesForColor(product, "  ")).toEqual(product.images);
  });

  it("falls back to the first colour gallery when the default gallery is empty", () => {
    const colorOnly = {
      images: [],
      colorImages: {
        bone: ["/uploads/bone-1.webp"],
        black: ["/uploads/black-1.webp", "/uploads/black-2.webp"],
      },
    };
    expect(imagesForColor(colorOnly, null)).toEqual([
      "/uploads/black-1.webp",
      "/uploads/black-2.webp",
    ]);
    expect(primaryImageForColor(colorOnly, null)).toBe("/uploads/black-1.webp");
  });

  it("has nothing to fall back to on a product with no images at all", () => {
    expect(imagesForColor({ images: [], colorImages: null }, "Black")).toEqual([]);
    expect(imagesForColor(null, "Black")).toEqual([]);
  });
});

describe("primaryImageForColor", () => {
  it("returns the first image of the gallery that would render", () => {
    expect(primaryImageForColor(product, "Bone")).toBe("/uploads/bone-1.webp");
    expect(primaryImageForColor(product, "Sand")).toBe("/uploads/default-1.webp");
    expect(primaryImageForColor({ images: [] }, "Black")).toBeNull();
  });
});

describe("colorHasOwnImages", () => {
  it("separates a colour with photography from one borrowing the default", () => {
    expect(colorHasOwnImages(product, "black")).toBe(true);
    expect(colorHasOwnImages(product, "Sand")).toBe(false);
    expect(colorHasOwnImages(product, null)).toBe(false);
  });
});

describe("colorImageCoverage", () => {
  it("counts the colour options that still need their own image", () => {
    const coverage = colorImageCoverage(
      [
        { color: "Black" },
        { color: "black " },
        { color: "Bone" },
        { color: "Sand" },
        { color: null },
        { color: "Red", active: false },
      ],
      product.colorImages
    );

    expect(coverage).toEqual({ total: 3, covered: 2, missing: ["sand"] });
  });
});

describe("planColorImageSync", () => {
  it("creates a row for a colour that has none yet", () => {
    const plan = planColorImageSync([], [{ color: "Bone", url: "/uploads/bone.webp" }]);

    expect(plan.create).toEqual([
      { colorKey: "bone", colorLabel: "Bone", url: "/uploads/bone.webp", sortOrder: 0 },
    ]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("writes nothing when the form is re-saved unchanged", () => {
    const plan = planColorImageSync(
      [stored({ id: "row-1" })],
      [{ color: "Black", url: "/uploads/black-1.webp" }]
    );

    expect(plan).toEqual({ create: [], update: [], remove: [] });
  });

  it("updates in place when a replacement image is uploaded", () => {
    const plan = planColorImageSync(
      [stored({ id: "row-1" })],
      [{ color: "Black", url: "/uploads/black-2.webp" }]
    );

    expect(plan.update).toEqual([
      { id: "row-1", url: "/uploads/black-2.webp", colorLabel: "Black" },
    ]);
    expect(plan.remove).toEqual([]);
  });

  it("treats a submitted colour as authoritative, so a changed slot is rewritten", () => {
    const plan = planColorImageSync(
      [
        stored({ id: "row-1", url: "/uploads/black-1.webp", sortOrder: 0 }),
        stored({ id: "row-2", url: "/uploads/black-2.webp", sortOrder: 1 }),
      ],
      [
        { color: "Black", url: "/uploads/black-1.webp", sortOrder: 0 },
        { color: "Black", url: "/uploads/black-3.webp", sortOrder: 1 },
      ]
    );

    expect(plan.update).toEqual([
      { id: "row-2", url: "/uploads/black-3.webp", colorLabel: "Black" },
    ]);
    expect(plan.remove).toEqual([]);
  });

  it("deletes the slot a shortened gallery no longer uses", () => {
    const plan = planColorImageSync(
      [
        stored({ id: "row-1", sortOrder: 0 }),
        stored({ id: "row-2", url: "/uploads/b.webp", sortOrder: 1 }),
      ],
      [{ color: "Black", url: "/uploads/black-1.webp", sortOrder: 0 }]
    );

    expect(plan.remove).toEqual(["row-2"]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
  });

  it("leaves a retired colour's images intact", () => {
    const plan = planColorImageSync(
      [
        stored({ id: "row-1", colorKey: "red", colorLabel: "Red" }),
        stored({ id: "row-2", colorKey: "black", colorLabel: "Black" }),
      ],
      [{ color: "Black", url: "/uploads/black-2.webp" }]
    );

    expect(plan.remove).toEqual([]);
    expect(plan.update).toEqual([
      { id: "row-2", url: "/uploads/black-2.webp", colorLabel: "Black" },
    ]);
  });

  it("lets an explicit removal win over a submitted image for that colour", () => {
    const plan = planColorImageSync(
      [stored({ id: "row-1" })],
      [{ color: "Black", url: "/uploads/black-2.webp" }],
      [" black "]
    );

    expect(plan.remove).toEqual(["row-1"]);
    expect(plan.update).toEqual([]);
    expect(plan.create).toEqual([]);
  });

  it("clears duplicate slots left by a raced write", () => {
    const plan = planColorImageSync(
      [stored({ id: "row-1" }), stored({ id: "row-2" })],
      [{ color: "Black", url: "/uploads/black-1.webp" }]
    );

    expect(plan.remove).toEqual(["row-2"]);
    expect(plan.update).toEqual([]);
  });

  it("ignores entries with no image", () => {
    const plan = planColorImageSync([], [{ color: "Black", url: "   " }]);
    expect(plan).toEqual({ create: [], update: [], remove: [] });
  });
});

describe("colorImageCreateRows", () => {
  it("keeps one row per colour slot", () => {
    expect(
      colorImageCreateRows([
        { color: "Black", url: "/uploads/black-1.webp", sortOrder: 0 },
        { color: " black ", url: "/uploads/black-2.webp", sortOrder: 0 },
        { color: "Bone", url: "/uploads/bone-1.webp" },
      ])
    ).toEqual([
      { colorKey: "black", colorLabel: "Black", url: "/uploads/black-1.webp", sortOrder: 0 },
      { colorKey: "bone", colorLabel: "Bone", url: "/uploads/bone-1.webp", sortOrder: 0 },
    ]);
  });
});

describe("isStoredImageUrl", () => {
  const base = "https://project.supabase.co";

  it("accepts the two paths the upload pipeline can produce", () => {
    expect(isStoredImageUrl("/uploads/products/a-1320.webp", base)).toBe(true);
    expect(
      isStoredImageUrl(`${base}/storage/v1/object/public/product-images/products/a-1320.webp`, base)
    ).toBe(true);
  });

  it("rejects anything else, including traversal and other hosts", () => {
    expect(isStoredImageUrl("https://evil.example/a.webp", base)).toBe(false);
    expect(isStoredImageUrl("/uploads/../../etc/passwd", base)).toBe(false);
    expect(isStoredImageUrl("/elsewhere/a.webp", base)).toBe(false);
    expect(isStoredImageUrl("", base)).toBe(false);
    expect(isStoredImageUrl(null, base)).toBe(false);
    expect(
      isStoredImageUrl(`${base}/storage/v1/object/public/product-images/../secret.webp`, base)
    ).toBe(false);
  });

  it("rejects a Supabase URL when no base is configured", () => {
    expect(isStoredImageUrl(`${base}/storage/v1/object/public/bucket/a.webp`, null)).toBe(false);
    expect(isStoredImageUrl("/uploads/a.webp", null)).toBe(true);
  });
});

describe("colour image request schemas", () => {
  const base = { name: "Tee", price: 100 };

  it("accepts colour images and removals on update", () => {
    const parsed = productUpdateSchema.safeParse({
      ...base,
      colorImages: [{ color: "Black", url: "/uploads/black.webp", sortOrder: 1 }],
      removeColorImages: ["Red"],
    });

    expect(parsed.success).toBe(true);
  });

  it("requires a colour and an image", () => {
    expect(
      productUpdateSchema.safeParse({ ...base, colorImages: [{ color: "", url: "/uploads/a.webp" }] })
        .success
    ).toBe(false);
    expect(
      productUpdateSchema.safeParse({ ...base, colorImages: [{ color: "Black", url: "" }] }).success
    ).toBe(false);
  });

  it("caps a colour's gallery and the slots inside it", () => {
    const tooMany = Array.from({ length: MAX_IMAGES_PER_COLOR + 1 }, (_, index) => ({
      color: "Black",
      url: `/uploads/black-${index}.webp`,
    }));
    expect(productUpdateSchema.safeParse({ ...base, colorImages: tooMany }).success).toBe(false);

    expect(
      productUpdateSchema.safeParse({
        ...base,
        colorImages: [{ color: "Black", url: "/uploads/a.webp", sortOrder: MAX_IMAGES_PER_COLOR }],
      }).success
    ).toBe(false);
  });

  it("accepts colour images when creating a product", () => {
    const parsed = productCreateSchema.safeParse({
      ...base,
      slug: "tee",
      colorImages: [{ color: "Bone", url: "/uploads/bone.webp" }],
    });

    expect(parsed.success).toBe(true);
  });
});

describe("admin form drafts", () => {
  const rows: StoredColorImageRow[] = [
    stored({
      id: "black-2",
      colorKey: "black",
      colorLabel: "Black",
      url: "/uploads/black-2.webp",
      sortOrder: 1,
    }),
    stored({
      id: "black-1",
      colorKey: "black",
      colorLabel: "Black",
      url: "/uploads/black-1.webp",
      sortOrder: 0,
    }),
    stored({ id: "oat-1", colorKey: "oat", colorLabel: "Oat", url: "/uploads/oat-1.webp" }),
  ];

  it("groups stored rows into one draft per colour, in slot order", () => {
    expect(colorImageDraftsFromRows(rows)).toEqual([
      { color: "Black", urls: ["/uploads/black-1.webp", "/uploads/black-2.webp"] },
      { color: "Oat", urls: ["/uploads/oat-1.webp"] },
    ]);
  });

  it("has no drafts for a product without colour images", () => {
    expect(colorImageDraftsFromRows(undefined)).toEqual([]);
    expect(colorImageDraftsFromRows([])).toEqual([]);
  });

  it("numbers slots by position, so the first upload is the cover", () => {
    expect(
      colorImagePayload([
        { color: " Black ", urls: ["/uploads/black-1.webp", "/uploads/black-2.webp"] },
        { color: "Oat", urls: [] },
      ])
    ).toEqual([
      { color: "Black", url: "/uploads/black-1.webp", sortOrder: 0 },
      { color: "Black", url: "/uploads/black-2.webp", sortOrder: 1 },
    ]);
  });

  it("sends nothing for a colour the admin left empty", () => {
    expect(colorImagePayload([{ color: "Oat", urls: ["   "] }])).toEqual([]);
    expect(colorImagePayload([{ color: "  ", urls: ["/uploads/a.webp"] }])).toEqual([]);
  });

  it("re-saving an unchanged edit form plans no writes", () => {
    const drafts = colorImageDraftsFromRows(rows);
    const plan = planColorImageSync(
      rows,
      colorImagePayload(drafts),
      clearedColorLabels(
        rows.map((row) => row.colorLabel),
        drafts
      )
    );

    expect(plan).toEqual({ create: [], update: [], remove: [] });
  });

  it("names only the colours the admin emptied, so those rows are deleted", () => {
    const drafts = colorImageDraftsFromRows(rows).filter(
      (draft) => normalizeColorKey(draft.color) !== "oat"
    );

    expect(clearedColorLabels(["Black", "Oat"], drafts)).toEqual(["Oat"]);

    const plan = planColorImageSync(
      rows,
      colorImagePayload(drafts),
      clearedColorLabels(
        rows.map((row) => row.colorLabel),
        drafts
      )
    );
    expect(plan.remove).toEqual(["oat-1"]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
  });

  it("keeps a retired colour that still holds images", () => {
    const drafts = colorImageDraftsFromRows(rows);

    // "Oat" is gone from the form's colour list, but its card still holds a photo.
    expect(clearedColorLabels(["Black", "Oat"], drafts)).toEqual([]);
  });

  it("compares stored colours to drafts case-insensitively", () => {
    expect(clearedColorLabels([" BLACK "], [])).toEqual(["BLACK"]);
    expect(clearedColorLabels([" black "], [{ color: "Black", urls: ["/uploads/a.webp"] }])).toEqual(
      []
    );
  });
});
