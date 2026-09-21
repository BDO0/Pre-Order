import { describe, expect, it, vi } from "vitest";

// The function under test is pure, but it lives next to the database helpers in
// batch-service.ts, and importing that module constructs a Prisma connection pool
// (which requires DATABASE_URL). The stub keeps this a unit test.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { isEmptyBatchWrite, normaliseBatchWrite } from "@/lib/batch-service";

// The bug these tests exist for: both admin route trees wrote every column on
// every PATCH (`description: description || null`), so a screen that managed a
// name, a note and a date wiped the description, the start date, the ETA and the
// cover image simply by not sending them. "Absent" and "cleared" are different
// things, and this is where that is decided.
describe("normaliseBatchWrite", () => {
  it("writes only the keys the request actually carried", () => {
    // A rename from a screen that knows nothing about dates or images.
    const data = normaliseBatchWrite({ name: "Batch 2" }, { name: "Batch 2" });

    expect(data).toEqual({ name: "Batch 2" });
    expect("description" in data).toBe(false);
    expect("endAt" in data).toBe(false);
    expect("coverImage" in data).toBe(false);
    expect("startAt" in data).toBe(false);
  });

  it("keeps a null or empty value as an explicit clear", () => {
    expect(normaliseBatchWrite({ notes: null }, { notes: null }).description).toBeNull();
    expect(normaliseBatchWrite({ notes: "" }, { notes: "" }).description).toBeNull();
    expect(normaliseBatchWrite({ coverImage: "" }, { coverImage: "" }).coverImage).toBeNull();
    expect(normaliseBatchWrite({ etaAt: null }, { etaAt: null }).endAt).toBeNull();
  });

  it("maps the screens' vocabulary onto the columns", () => {
    const data = normaliseBatchWrite(
      { notes: "Supplier in Guangzhou", etaAt: "2026-10-01T09:00:00.000Z" },
      { notes: "Supplier in Guangzhou", etaAt: "2026-10-01T09:00:00.000Z" }
    );

    expect(data.description).toBe("Supplier in Guangzhou");
    expect(data.endAt?.toISOString()).toBe("2026-10-01T09:00:00.000Z");
  });

  it("lets the canonical name win when both spellings arrive", () => {
    const data = normaliseBatchWrite(
      { description: "canonical", notes: "alias" },
      { description: "canonical", notes: "alias" }
    );

    expect(data.description).toBe("canonical");
  });

  it("treats a cleared date field as no date rather than an Invalid Date", () => {
    // This is `parseEta` doing its job: a browser sends "" for an emptied
    // datetime-local input, and Prisma must not be handed an Invalid Date.
    const data = normaliseBatchWrite({ etaAt: "" }, { etaAt: "" });
    expect(data.endAt).toBeNull();
  });

  it("de-duplicates product ids, so the unique index cannot abort the swap", () => {
    const data = normaliseBatchWrite(
      { productIds: ["p1", "p1", "p2"] },
      { productIds: ["p1", "p1", "p2"] }
    );

    expect(data.productIds).toEqual(["p1", "p2"]);
  });

  it("slugifies a slug that was sent, and ignores one that was not", () => {
    expect(normaliseBatchWrite({ slug: "Summer 2026" }, { slug: "Summer 2026" }).slug).toBe(
      "summer-2026"
    );
    expect("slug" in normaliseBatchWrite({ name: "x" }, { name: "x" })).toBe(false);
  });

  it("knows when a request asked for nothing", () => {
    expect(isEmptyBatchWrite(normaliseBatchWrite({}, {}))).toBe(true);
    expect(isEmptyBatchWrite(normaliseBatchWrite({ name: "x" }, { name: "x" }))).toBe(false);
  });
});
