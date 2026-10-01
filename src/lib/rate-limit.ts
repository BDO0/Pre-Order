import { NextResponse } from "next/server";
import { prisma } from "./db";

export interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowMs: number;
  failClosed?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

const PRUNE_GRACE_MS = 60 * 60 * 1000;

const PRUNE_EVERY = 500;

let callsSincePrune = 0;

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

export async function rateLimit(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const now = new Date();
  const bucketKey = `${options.bucket}:${key}`;
  const windowEndsAt = new Date(now.getTime() + options.windowMs);

  try {
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

function lastHop(header: string | null): string | null {
  if (!header) return null;
  const hops = header.split(",");
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = hops[index]?.trim();
    if (hop) return hop;
  }
  return null;
}

const IS_VERCEL = Boolean(process.env.VERCEL);

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
  publicRead: { bucket: "public-read", limit: 240, windowMs: 60_000, failClosed: false },
} as const satisfies Record<string, RateLimitOptions>;
