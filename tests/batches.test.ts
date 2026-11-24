import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import {
  describeEta,
  etaState,
  fromDateTimeInputValue,
  getBatchWindowState,
  isBatchAcceptingOrders,
  parseEta,
  slugifyBatchName,
  toDateTimeInputValue,
  ETA_SOON_DAYS,
} from "@/lib/batches";
import { formatManilaDateParts } from "@/lib/order-number";

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

describe("isBatchAcceptingOrders & getBatchWindowState", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");

  it("allows ordering when status is OPEN and within startAt/endAt window", () => {
    expect(isBatchAcceptingOrders({ status: "OPEN" }, now)).toBe(true);
    expect(
      isBatchAcceptingOrders(
        {
          status: "OPEN",
          startAt: "2026-09-10T00:00:00.000Z",
          endAt: "2026-09-20T00:00:00.000Z",
        },
        now
      )
    ).toBe(true);
  });

  it("rejects ordering before startAt or after endAt even if status is still OPEN", () => {
    expect(
      getBatchWindowState(
        { status: "OPEN", startAt: "2026-09-14T00:00:00.000Z" },
        now
      )
    ).toBe("not_started");
    expect(
      getBatchWindowState(
        { status: "OPEN", endAt: "2026-09-13T11:59:59.000Z" },
        now
      )
    ).toBe("expired");
    expect(
      isBatchAcceptingOrders(
        { status: "OPEN", endAt: "2026-09-13T11:59:59.000Z" },
        now
      )
    ).toBe(false);
  });

  it("rejects ordering when status is not OPEN", () => {
    expect(getBatchWindowState({ status: "CLOSED" }, now)).toBe("closed");
    expect(getBatchWindowState({ status: "DRAFT" }, now)).toBe("closed");
    expect(isBatchAcceptingOrders(null, now)).toBe(false);
  });
});

describe("formatManilaDateParts (Asia/Manila order reference date)", () => {
  it("uses Asia/Manila date for early morning PH orders (00:00–07:59 PH / 16:00–23:59 previous day UTC)", () => {
    // 2026-11-24 18:30:00 UTC is 2026-11-25 02:30:00 in Asia/Manila (UTC+8)
    const earlyMorningPh = new Date("2026-11-24T18:30:00.000Z");
    const parts = formatManilaDateParts(earlyMorningPh);
    expect(parts.compact).toBe("20261125");
    expect(parts.isoDay).toBe("2026-11-25");
  });
});
