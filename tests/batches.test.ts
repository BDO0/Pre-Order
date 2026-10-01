import { describe, expect, it } from "vitest";
import {
  describeEta,
  etaState,
  fromDateTimeInputValue,
  parseEta,
  slugifyBatchName,
  toDateTimeInputValue,
  ETA_SOON_DAYS,
} from "@/lib/batches";

describe("parseEta", () => {
  it("treats a cleared form input as no ETA, not as a bad date", () => {
    expect(parseEta("")).toBeNull();
    expect(parseEta("   ")).toBeNull();
    expect(parseEta(null)).toBeNull();
    expect(parseEta(undefined)).toBeNull();
  });

  it("keeps a real date", () => {
    const parsed = parseEta("2026-10-01T09:00:00.000Z");
    expect(parsed?.toISOString()).toBe("2026-10-01T09:00:00.000Z");
  });

  it("returns null rather than an Invalid Date for nonsense", () => {
    expect(parseEta("not a date")).toBeNull();
  });
});

describe("etaState", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");

  it("has no state without a date", () => {
    expect(etaState(null, now)).toBe("none");
    expect(etaState("", now)).toBe("none");
  });

  it("treats a past date as arrived, not as a negative countdown", () => {
    expect(etaState("2026-09-01T12:00:00.000Z", now)).toBe("arrived");
    expect(etaState("2026-09-13T11:00:00.000Z", now)).toBe("arrived");
  });

  it("flags the last week before the date as soon", () => {
    expect(etaState("2026-09-20T12:00:00.000Z", now)).toBe("soon");
    expect(etaState("2026-09-13T12:00:00.000Z", now)).toBe("soon");
  });

  it("leaves anything further out as merely scheduled", () => {
    const beyond = new Date(now.getTime() + (ETA_SOON_DAYS + 2) * 24 * 60 * 60 * 1000);
    expect(etaState(beyond, now)).toBe("scheduled");
  });
});

describe("describeEta", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");

  it("says so when there is no date", () => {
    expect(describeEta(null, now)).toBe("No ETA yet");
  });

  it("counts down in days, with the wording a person would use", () => {
    expect(describeEta("2026-09-13T18:00:00.000Z", now)).toBe("Due today");
    expect(describeEta("2026-09-14T12:00:00.000Z", now)).toBe("Due tomorrow");
    expect(describeEta("2026-09-18T12:00:00.000Z", now)).toBe("Due in 5 days");
  });

describe("slugifyBatchName", () => {
  it("produces a URL-safe slug from the name a person would type", () => {
    expect(slugifyBatchName("Batch 1 — October")).toBe("batch-1-october");
    expect(slugifyBatchName("  Spaced   Out  ")).toBe("spaced-out");
    expect(slugifyBatchName("UPPER_case")).toBe("upper-case");
  });

  it("folds accents instead of dropping the letter", () => {
    expect(slugifyBatchName("Summer Café")).toBe("summer-cafe");
    expect(slugifyBatchName("Áo Dài")).toBe("ao-dai");
  });

  it("never ends or starts with a hyphen, and stays within the length cap", () => {
    const long = slugifyBatchName("a".repeat(200));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.startsWith("-")).toBe(false);
    expect(long.endsWith("-")).toBe(false);
    expect(slugifyBatchName("🛍️🛍️")).toBe("");
  });
});

describe("datetime-local conversion", () => {
  it("round-trips a local wall-clock value back to the same instant", () => {
    const iso = "2026-10-01T09:30:00.000Z";
    const local = toDateTimeInputValue(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fromDateTimeInputValue(local)).toBe(iso);
  });

  it("treats blank and absent the same way, in both directions", () => {
    expect(toDateTimeInputValue(null)).toBe("");
    expect(toDateTimeInputValue("")).toBe("");
    expect(toDateTimeInputValue("not a date")).toBe("");
    expect(fromDateTimeInputValue("")).toBeNull();
    expect(fromDateTimeInputValue("   ")).toBeNull();
  });

  it("does not silently shift a date across a save", () => {
    const iso = "2026-12-31T23:45:00.000Z";
    const once = fromDateTimeInputValue(toDateTimeInputValue(iso));
    const twice = fromDateTimeInputValue(toDateTimeInputValue(once));
    expect(once).toBe(iso);
    expect(twice).toBe(iso);
  });
});

  it("reports a missed date as overdue", () => {
    expect(describeEta("2026-09-12T12:00:00.000Z", now)).toBe("Was due 1 day ago");
    expect(describeEta("2026-09-10T12:00:00.000Z", now)).toBe("Was due 3 days ago");
  });
});
