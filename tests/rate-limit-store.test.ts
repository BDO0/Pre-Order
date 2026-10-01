import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const OPTIONS = { bucket: "test", limit: 3, windowMs: 60_000 };

describe.skipIf(!TEST_DATABASE_URL)("rateLimit", () => {
  let prisma!: PrismaClient;
  let rateLimit!: (typeof import("@/lib/rate-limit"))["rateLimit"];
  let touchedKeys: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    ({ prisma } = await import("@/lib/db"));
    ({ rateLimit } = await import("@/lib/rate-limit"));
  });

  afterEach(async () => {
    if (touchedKeys.length > 0) {
      await prisma.rateLimitBucket.deleteMany({ where: { key: { in: touchedKeys } } });
    }
    touchedKeys = [];
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function freshCaller(): string {
    return `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
  }

  function track(bucket: string, caller: string): string {
    const key = `${bucket}:${caller}`;
    touchedKeys.push(key);
    return caller;
  }

  it("allows exactly the budget and then refuses", async () => {
    const caller = track(OPTIONS.bucket, freshCaller());
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await rateLimit(caller, OPTIONS));

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[0].remaining).toBe(2);
    expect(results[3].remaining).toBe(0);
    expect(results[3].retryAfterSeconds).toBeGreaterThan(0);
  });

  it("gives every caller their own budget", async () => {
    const first = track(OPTIONS.bucket, freshCaller());
    const second = track(OPTIONS.bucket, freshCaller());

    for (let i = 0; i < 4; i += 1) await rateLimit(first, OPTIONS);

    expect((await rateLimit(first, OPTIONS)).allowed).toBe(false);
    expect((await rateLimit(second, OPTIONS)).allowed).toBe(true);
  });

  it("does not let one endpoint consume another budget", async () => {
    const caller = track(OPTIONS.bucket, freshCaller());
    touchedKeys.push(`other:${caller}`);

    for (let i = 0; i < 4; i += 1) await rateLimit(caller, OPTIONS);

    expect((await rateLimit(caller, OPTIONS)).allowed).toBe(false);
    expect((await rateLimit(caller, { ...OPTIONS, bucket: "other" })).allowed).toBe(true);
  });

  it("forgets the count once the window has elapsed", async () => {
    const windowed = { bucket: "window", limit: 1, windowMs: 300 };
    const caller = track(windowed.bucket, freshCaller());

    expect((await rateLimit(caller, windowed)).allowed).toBe(true);
    expect((await rateLimit(caller, windowed)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect((await rateLimit(caller, windowed)).allowed).toBe(true);
  });

  it("counts a burst that lands on a just-expired window", async () => {
    const windowed = { bucket: "burst", limit: 2, windowMs: 1500 };
    const caller = track(windowed.bucket, freshCaller());

    await rateLimit(caller, windowed);
    await new Promise((resolve) => setTimeout(resolve, 1600));

    const burst = await Promise.all(
      Array.from({ length: 5 }, () => rateLimit(caller, windowed))
    );

    expect(burst.filter((result) => result.allowed)).toHaveLength(2);
  });
});
