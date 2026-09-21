import { NextResponse } from "next/server";

/**
 * Fixed-window, in-memory rate limiter.
 *
 * Scope and limitations, stated plainly: the counters live in this Node process,
 * so on a multi-instance or serverless deployment each instance enforces its own
 * budget and a cold start forgets everything. That still stops the realistic
 * attacks here (a script hammering checkout, login, or the proof uploader at
 * thousands of requests a second) without adding Redis to a shop that has one
 * admin. If traffic ever justifies it, replace the `buckets` map with a shared
 * store behind the same function signature.
 */

interface Bucket {
  count: number;
  /** Epoch ms at which the window rolls over. */
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Hard cap so a spray of unique keys cannot grow the map without bound. */
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitOptions {
  /** Namespace so two routes do not share a budget. */
  bucket: string;
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets — sent as `Retry-After`. */
  retryAfterSeconds: number;
}

function sweep(now: number): void {
  if (buckets.size < MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still full of live windows: drop the oldest entries rather than grow.
  if (buckets.size >= MAX_TRACKED_KEYS) {
    const overflow = buckets.size - MAX_TRACKED_KEYS;
    let removed = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++removed >= overflow) break;
    }
  }
}

/** Consumes one token from `key`'s budget and reports what is left. */
export function rateLimit(
  key: string,
  options: RateLimitOptions
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucketKey = `${options.bucket}:${key}`;
  const existing = buckets.get(bucketKey);

  if (!existing || existing.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + options.windowMs });
    return {
      allowed: true,
      limit: options.limit,
      remaining: options.limit - 1,
      retryAfterSeconds: 0,
    };
  }

  existing.count += 1;
  const remaining = Math.max(0, options.limit - existing.count);

  return {
    allowed: existing.count <= options.limit,
    limit: options.limit,
    remaining,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((existing.resetAt - now) / 1000)
    ),
  };
}

/**
 * Best-effort client identity.
 *
 * `x-forwarded-for` is set by the platform (Vercel, a reverse proxy) and is
 * client-spoofable when it is not, so this is a throttle key, never an
 * authorization decision.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Returns a 429 response when the caller is over budget, or null to continue.
 *
 * Usage:
 *   const limited = enforceRateLimit(request, CHECKOUT_LIMIT);
 *   if (limited) return limited;
 */
export function enforceRateLimit(
  request: Request,
  options: RateLimitOptions
): NextResponse | null {
  const result = rateLimit(clientIp(request), options);

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

/** Named budgets, so every route states its intent in one place. */
export const RATE_LIMITS = {
  /** A customer checks out a handful of times an hour, not hundreds. */
  checkout: { bucket: "checkout", limit: 10, windowMs: 5 * 60_000 },
  /** Proof uploads are one per checkout attempt; allow a few retries. */
  upload: { bucket: "upload", limit: 20, windowMs: 5 * 60_000 },
  /** Order lookup takes reference + Instagram handle, so make brute force costly. */
  orderLookup: { bucket: "order-lookup", limit: 30, windowMs: 5 * 60_000 },
  /**
   * Changing a password re-checks the current one, so this is a guess budget:
   * a stolen session cookie must not become an offline-speed password oracle.
   */
  passwordChange: { bucket: "password-change", limit: 10, windowMs: 15 * 60_000 },
  /** Credential stuffing defence for the admin login. */
  login: { bucket: "login", limit: 10, windowMs: 5 * 60_000 },
  /** Cheap read endpoints: generous, but not unlimited. */
  publicRead: { bucket: "public-read", limit: 240, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitOptions>;

/** Test helper — clears all windows. */
export function resetRateLimits(): void {
  buckets.clear();
}
