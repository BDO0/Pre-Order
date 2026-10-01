import { NextResponse } from "next/server";
import { prisma } from "./db";

export interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowMs: number;
  /**
   * What to do when the limiter store itself is unreachable.
   *
   * `true` (deny) is for budgets guarding credentials or money: a database
   * outage must not become an open door. `false` (allow) is for read budgets,
   * where refusing traffic would take the shop down for no security gain.
   * Defaults to `false`, so a browsing limit can never black out the site.
   */
  failClosed?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Buckets whose window closed this long ago are removed by the next prune.
 * The grace period keeps a bucket that has only just expired from being
 * deleted while a request is still reading its window.
 */
const PRUNE_GRACE_MS = 60 * 60 * 1000;

/** Roughly one call in this many runs the prune, so its cost is amortised. */
const PRUNE_EVERY = 500;

let callsSincePrune = 0;

/**
 * Deletes buckets whose window closed over an hour ago.
 *
 * The in-memory limiter this replaced swept expired keys. Without an
 * equivalent the table grows by one row per bucket and client for ever, and
 * IPv6 gives a single caller enough distinct addresses to make that
 * unbounded. `resetAt` is indexed for exactly this query. Never throws.
 */
async function pruneExpiredBuckets(now: Date): Promise<void> {
  callsSincePrune += 1;
  if (callsSincePrune < PRUNE_EVERY) return;
  callsSincePrune = 0;
  try {
    await prisma.rateLimitBucket.deleteMany({
      where: { resetAt: { lt: new Date(now.getTime() - PRUNE_GRACE_MS) } },
    });
  } catch (error) {
    console.error("[rateLimit] could not prune expired buckets", error);
  }
}

/**
 * Consumes one unit of the key budget and reports what is left.
 *
 * The increment, the window reset and the read are ONE statement. Reading
 * first and writing second would let two concurrent callers both observe an
 * expired window and both reset the counter, so a well-timed burst could
 * clear its own budget - the same reason `order-number.ts` counts in a single
 * `INSERT ... ON CONFLICT ... RETURNING`.
 *
 * Never throws. If the store is unreachable the outcome is decided by
 * `failClosed`, so a database outage cannot turn a 429 into a 500.
 */
export async function rateLimit(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const now = new Date();
  const bucketKey = `${options.bucket}:${key}`;
  const windowEndsAt = new Date(now.getTime() + options.windowMs);

  try {
    // The column is `timestamp(3)` holding UTC wall-clock, so it is compared
    // against a JS parameter rather than Postgres `now()`. Comparing it to a
    // timestamptz would shift the window by the session time zone.
    // The seconds remaining are computed by Postgres rather than by JavaScript:
    // node-postgres parses `timestamp` without a zone as a local-time Date, so
    // subtracting in JS could be off by the server UTC offset.
    const rows = await prisma.$queryRaw<
      Array<{ count: number; retryAfter: number }>
    >`
      INSERT INTO "rate_limit_buckets" ("key", "count", "resetAt", "updatedAt")
      VALUES (${bucketKey}, 1, ${windowEndsAt}, ${now})
      ON CONFLICT ("key") DO UPDATE
        SET "count" = CASE
              WHEN "rate_limit_buckets"."resetAt" <= ${now} THEN 1
              ELSE "rate_limit_buckets"."count" + 1
            END,
            "resetAt" = CASE
              WHEN "rate_limit_buckets"."resetAt" <= ${now} THEN ${windowEndsAt}
              ELSE "rate_limit_buckets"."resetAt"
            END,
            "updatedAt" = ${now}
      RETURNING "count",
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("resetAt" - ${now}))))::int AS "retryAfter"
    `;

    await pruneExpiredBuckets(now);

    const row = rows[0];
    const currentCount = Number(row?.count ?? 1);
    const retryAfterSeconds = Number(
      row?.retryAfter ?? Math.ceil(options.windowMs / 1000)
    );

    return {
      allowed: currentCount <= options.limit,
      limit: options.limit,
      remaining: Math.max(0, options.limit - currentCount),
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    };
  } catch (error) {
    console.error("[rateLimit] store unavailable", error);
    if (options.failClosed) {
      return { allowed: false, limit: options.limit, remaining: 0, retryAfterSeconds: 60 };
    }
    return { allowed: true, limit: options.limit, remaining: options.limit, retryAfterSeconds: 0 };
  }
}

/** Reads the last non-empty hop of a comma-separated forwarding header. */
function lastHop(header: string | null): string | null {
  if (!header) return null;
  const hops = header.split(",");
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = hops[index]?.trim();
    if (hop) return hop;
  }
  return null;
}

/** Vercel sets this header itself, so it is only trusted when running there. */
const IS_VERCEL = Boolean(process.env.VERCEL);

/**
 * The caller address, as far as it can be trusted.
 *
 * `x-forwarded-for` is a list a client can seed: the client value is the
 * FIRST entry and each proxy appends to the end. Taking the first, as this
 * did, let any caller choose their own bucket by sending the header, which
 * defeated every limit including the one guarding admin sign-in. The last hop
 * is the one our own edge appended.
 */
export function clientIp(request: Request): string {
  if (IS_VERCEL) {
    const vercelIp = lastHop(request.headers.get("x-vercel-forwarded-for"));
    if (vercelIp) return vercelIp;
  }

  const forwardedIp = lastHop(request.headers.get("x-forwarded-for"));
  if (forwardedIp) return forwardedIp;

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function enforceRateLimit(
  request: Request,
  options: RateLimitOptions
): Promise<NextResponse | null> {
  const result = await rateLimit(clientIp(request), options);
  if (result.allowed) return null;

  return NextResponse.json(
    {
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait a moment and try again.",
      },
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}

export const RATE_LIMITS = {
  checkout: { bucket: "checkout", limit: 10, windowMs: 5 * 60_000, failClosed: true },
  upload: { bucket: "upload", limit: 20, windowMs: 5 * 60_000, failClosed: true },
  orderLookup: { bucket: "order-lookup", limit: 30, windowMs: 5 * 60_000, failClosed: true },
  passwordChange: { bucket: "password-change", limit: 10, windowMs: 15 * 60_000, failClosed: true },
  login: { bucket: "login", limit: 10, windowMs: 5 * 60_000, failClosed: true },
  // Reads stay open when the store is down: refusing them would take the
  // storefront and /api/health with it, and no credential is at stake.
  publicRead: { bucket: "public-read", limit: 240, windowMs: 60_000, failClosed: false },
} as const satisfies Record<string, RateLimitOptions>;
