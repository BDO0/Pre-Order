import { afterEach, describe, expect, it } from "vitest";
import {
  RATE_LIMITS,
  clientIp,
  rateLimit,
  resetRateLimits,
} from "@/lib/rate-limit";

const OPTIONS = { bucket: "test", limit: 3, windowMs: 60_000 };

describe("rateLimit", () => {
  afterEach(() => {
    resetRateLimits();
  });

  it("allows exactly the budget and then refuses", () => {
    const results = [1, 2, 3, 4].map(() => rateLimit("1.2.3.4", OPTIONS));

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[0].remaining).toBe(2);
    expect(results[3].remaining).toBe(0);
    expect(results[3].retryAfterSeconds).toBeGreaterThan(0);
  });

  it("gives every caller their own budget", () => {
    // An attacker exhausting their own allowance must not lock out everyone else
    // — that would turn a throttle into a denial of service.
    for (let i = 0; i < 4; i += 1) rateLimit("10.0.0.1", OPTIONS);

    expect(rateLimit("10.0.0.1", OPTIONS).allowed).toBe(false);
    expect(rateLimit("10.0.0.2", OPTIONS).allowed).toBe(true);
  });

  it("does not let one endpoint consume another's budget", () => {
    for (let i = 0; i < 4; i += 1) rateLimit("10.0.0.9", OPTIONS);

    expect(rateLimit("10.0.0.9", OPTIONS).allowed).toBe(false);
    expect(
      rateLimit("10.0.0.9", { ...OPTIONS, bucket: "other" }).allowed
    ).toBe(true);
  });

  it("forgets the count once the window has elapsed", async () => {
    const windowed = { bucket: "window", limit: 1, windowMs: 25 };

    expect(rateLimit("10.0.0.3", windowed).allowed).toBe(true);
    expect(rateLimit("10.0.0.3", windowed).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(rateLimit("10.0.0.3", windowed).allowed).toBe(true);
  });
});

describe("clientIp", () => {
  it("uses the first hop of x-forwarded-for", () => {
    const request = new Request("http://localhost/api/orders", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientIp(request)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to a shared bucket", () => {
    expect(
      clientIp(
        new Request("http://localhost/", { headers: { "x-real-ip": "203.0.113.9" } })
      )
    ).toBe("203.0.113.9");

    // "unknown" means all unidentifiable callers share one budget. That is the
    // conservative outcome: it can only make the throttle stricter.
    expect(clientIp(new Request("http://localhost/"))).toBe("unknown");
  });
});

describe("named budgets", () => {
  it("are all usable windows with a distinct namespace", () => {
    const buckets = new Set<string>();

    for (const [name, options] of Object.entries(RATE_LIMITS)) {
      expect(options.limit, name).toBeGreaterThan(0);
      expect(options.windowMs, name).toBeGreaterThan(0);
      expect(options.bucket.length, name).toBeGreaterThan(0);
      buckets.add(options.bucket);
    }

    // Two routes sharing a bucket would silently halve each other's allowance.
    expect(buckets.size).toBe(Object.keys(RATE_LIMITS).length);
  });

  it("keeps credential guessing far tighter than browsing", () => {
    expect(RATE_LIMITS.login.limit).toBeLessThan(RATE_LIMITS.publicRead.limit);
    expect(RATE_LIMITS.checkout.limit).toBeLessThan(RATE_LIMITS.publicRead.limit);
  });
});
