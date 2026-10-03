import { describe, expect, it } from "vitest";
import { formatMoney, formatShortDate } from "@/lib/format";

describe("formatMoney", () => {
  it("renders whole amounts without decimals, matching the legacy markup", () => {
    expect(formatMoney(899)).toBe("₱899");
    expect(formatMoney(1299)).toBe("₱1,299");
    expect(formatMoney(3097)).toBe("₱3,097");
  });

  it("keeps at most two decimals for fractional amounts", () => {
    expect(formatMoney(150.5)).toBe("₱150.5");
    expect(formatMoney(0.75)).toBe("₱0.75");
    expect(formatMoney(1299.456)).toBe("₱1,299.46");
  });

  it("defaults to PHP and honours an explicit or lower-cased currency", () => {
    expect(formatMoney(899, "PHP")).toBe("₱899");
    expect(formatMoney(899, "USD")).toBe("$899");
    expect(formatMoney(899, "usd")).toBe("$899");
  });

  it("falls back to the currency code when we have no glyph for it", () => {
    expect(formatMoney(899, "AUD")).toBe("AUD 899");
  });

  it("puts the sign in front of the symbol", () => {
    expect(formatMoney(-150)).toBe("-₱150");
  });

  it("treats a non-finite amount as zero instead of rendering NaN", () => {
    expect(formatMoney(Number.NaN)).toBe("₱0");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("₱0");
  });
});

describe("formatShortDate", () => {
  it("formats a local date as a short month and day", () => {
    expect(formatShortDate(new Date(2026, 2, 14, 12, 0, 0))).toBe("Mar 14");
  });

  it("accepts the same instant arriving as an ISO string", () => {
    const local = new Date(2026, 2, 14, 12, 0, 0);
    expect(formatShortDate(local.toISOString())).toBe("Mar 14");
  });

  it("returns null for absent or unparseable input", () => {
    expect(formatShortDate(null)).toBeNull();
    expect(formatShortDate(undefined)).toBeNull();
    expect(formatShortDate("")).toBeNull();
    expect(formatShortDate("not a date")).toBeNull();
  });
});
