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

// The ETA is the only promise the app makes to a customer about timing, and it
// is written by a human. These tests pin the two things that matter: a cleared
// date is "no ETA" rather than an invalid one, and a date that has passed reads
// as needing attention rather than as a countdown.
describe("parseEta", () => {
  it("treats a cleared form input as no ETA, not as a bad date", () => {
    // A browser sends "" when the operator empties a datetime-local field.
    // Storing that would create an Invalid Date in the database.
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
    // Even an hour late: the supplier window has been missed.
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

// The slug is the public pre-order URL, so it has to survive whatever an operator
// types into a name field. It is derived on the server precisely so that no screen
// has to invent one (and so that no screen can invent a duplicate).
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
    // A name that cannot be a URL yields nothing, so the caller can supply the
    // fallback: only it knows what an emoji-only name should become.
    expect(slugifyBatchName("🛍️🛍️")).toBe("");
  });
});

// `datetime-local` holds local wall-clock time while the API stores an instant.
// Reading one as the other shifted every date by the timezone offset on every
// save, so the round trip is the property worth pinning.
describe("datetime-local conversion", () => {
  it("round-trips a local wall-clock value back to the same instant", () => {
    const iso = "2026-10-01T09:30:00.000Z";
    const local = toDateTimeInputValue(iso);
    // The shape a `datetime-local` input requires. The value itself depends on the
    // machine's timezone, which is the point — it must not be asserted as UTC.
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
    // Whatever the machine's zone, converting out and back must be stable: the
    // failure mode was a value that moved by the offset on every edit.
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
