import { afterEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITS } from "@/lib/rate-limit";

// rate-limit.ts imports the Prisma client at module scope, and that client
// throws when DATABASE_URL is unset (src/lib/db.ts). Everything here exercises
// the pure helpers, so the client is stubbed and the file runs anywhere. The
// behaviour that genuinely needs a database lives in
// tests/rate-limit-store.test.ts, behind TEST_DATABASE_URL.
vi.mock("@/lib/db", () => ({ prisma: {} }));

/**
 * Loads a fresh copy of the module with the Vercel flag set as desired.
 *
 * `IS_VERCEL` is computed once at module load, so the platform branch can only
 * be exercised by resetting the registry and importing again.
 */
async function loadClientIp(vercel: boolean) {
  vi.resetModules();
  vi.stubEnv("VERCEL", vercel ? "1" : "");
  const { clientIp } = await import("@/lib/rate-limit");
  return clientIp;
}

const request = (headers: Record<string, string>) =>
  new Request("http://localhost/api/orders", { headers });

describe("clientIp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("takes the last hop of x-forwarded-for, not the client-supplied first", async () => {
    const clientIp = await loadClientIp(false);
    // A caller who prepends their own address used to choose their own bucket,
    // which defeated every limit including the one guarding sign-in.
    expect(clientIp(request({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe(
      "203.0.113.7"
    );
  });

  it("ignores a forged x-vercel-forwarded-for off Vercel", async () => {
    const clientIp = await loadClientIp(false);
    expect(clientIp(request({ "x-vercel-forwarded-for": "9.9.9.9" }))).toBe("unknown");
  });

  it("trusts x-vercel-forwarded-for on Vercel, where the platform sets it", async () => {
    const clientIp = await loadClientIp(true);
    expect(clientIp(request({ "x-vercel-forwarded-for": "203.0.113.8" }))).toBe(
      "203.0.113.8"
    );
  });

  it("falls back to x-real-ip, then to a shared bucket", async () => {
    const clientIp = await loadClientIp(false);
    expect(clientIp(request({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(request({}))).toBe("unknown");
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

    expect(buckets.size).toBe(Object.keys(RATE_LIMITS).length);
  });

  it("keeps credential guessing far tighter than browsing", () => {
    expect(RATE_LIMITS.login.limit).toBeLessThan(RATE_LIMITS.publicRead.limit);
    expect(RATE_LIMITS.checkout.limit).toBeLessThan(RATE_LIMITS.publicRead.limit);
  });

  it("denies sign-in, checkout and uploads when the limiter store is down", () => {
    expect(RATE_LIMITS.login.failClosed).toBe(true);
    expect(RATE_LIMITS.checkout.failClosed).toBe(true);
    expect(RATE_LIMITS.upload.failClosed).toBe(true);
  });

  it("keeps browsing open when the limiter store is down", () => {
    // Refusing reads would take the storefront and /api/health down alongside
    // the database, and no credential is at stake on a browse.
    expect(RATE_LIMITS.publicRead.failClosed).toBe(false);
  });
});
