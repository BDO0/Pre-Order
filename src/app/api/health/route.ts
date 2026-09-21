import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { describeStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Liveness probe that also touches the database.
 *
 * Three jobs:
 *
 *  1. A deploy/uptime check that fails when the app is up but the database is
 *     not, which is the failure mode a plain 200 on `/` would hide.
 *  2. Reporting which storage driver is active. This is the check that catches a
 *     serverless deployment trying to write imagery to a read-only filesystem —
 *     a failure that otherwise only surfaces when the operator publishes a drop.
 *  3. Keeping a Supabase free-tier project from being paused for inactivity.
 *     Point a scheduled ping (Vercel Cron, UptimeRobot, GitHub Actions) at this
 *     route every few days and the instance stays warm. Idle pausing is a free
 *     tier behaviour, so this is the cheap mitigation — a paid plan or the
 *     pooler host is the other half.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, RATE_LIMITS.publicRead);
  if (limited) return limited;

  const startedAt = Date.now();
  const storage = describeStorage();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        success: true,
        data: {
          status: "ok",
          database: "up",
          storage,
          latencyMs: Date.now() - startedAt,
          checkedAt: new Date().toISOString(),
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[GET /api/health] database check failed", error);

    // 503 so a monitor alerts instead of treating "app booted" as healthy.
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "The database is not reachable.",
        },
        data: {
          status: "degraded",
          database: "down",
          storage,
          latencyMs: Date.now() - startedAt,
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
