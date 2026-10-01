import { describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_BYTES,
  generateAccessToken,
  isAccessTokenShaped,
} from "@/lib/order-token";

describe("generateAccessToken", () => {
  it("is 192 bits of output, base64url-encoded", () => {
    const token = generateAccessToken();

    expect(ACCESS_TOKEN_BYTES).toBe(24);
    expect(token).toHaveLength(32);
  });

  it("stays inside the query-string-safe alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      const token = generateAccessToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token).not.toContain("+");
      expect(token).not.toContain("/");
      expect(token).not.toContain("=");
    }
  });

  it("never repeats itself", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      seen.add(generateAccessToken());
    }
    expect(seen.size).toBe(2000);
  });

  it("produces a different value on every call, with no shared prefix", () => {
    const first = generateAccessToken();
    const second = generateAccessToken();

    expect(first).not.toBe(second);
    expect(first.slice(0, 8)).not.toBe(second.slice(0, 8));
  });
});

describe("isAccessTokenShaped", () => {
  it("accepts everything this app mints", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(isAccessTokenShaped(generateAccessToken())).toBe(true);
    }
  });

  it("rejects anything that is not that shape", () => {
    for (const value of [
      "a".repeat(31),
      "a".repeat(33),
      "a".repeat(32) + "-",
      "has spaces".padEnd(32, " "),
      "a".repeat(31) + "+", 
      "a".repeat(31) + "/",
      "a".repeat(31) + "=",
      "",
      null,
      undefined,
      42,
      {},
      [],
      true,
    ]) {
      expect(isAccessTokenShaped(value)).toBe(false);
    }
  });

  it("rejects a reference number, so `?token=` cannot be used as a lookup", () => {
    expect(isAccessTokenShaped("PO-20260917-0001")).toBe(false);
  });
});
