import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
export async function GET(request: NextRequest) {
  try {
    const limited = await enforceRateLimit(request, RATE_LIMITS.publicRead);
    if (limited) return limited;
    const now = new Date();
    const batches = await prisma.batch.findMany({
      where: {
        status: { in: ["OPEN", "SCHEDULED"] },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        coverImage: true,
        status: true,
        startAt: true,
        endAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    const openBatches = batches.filter((b) => {
      // A SCHEDULED batch with no startAt has never been announced, and the two
      // guards below would both pass it through: the date checks only fire when
      // startAt or endAt is set. That leaked unreleased drops, with their name,
      // description and cover image, to anyone hitting this public route.
      if (b.status === "SCHEDULED" && !b.startAt) return false;
      if (b.endAt && now > b.endAt) return false;
      if (b.startAt && now < b.startAt) return false;
      return true;
    });
    return NextResponse.json({ success: true, data: openBatches });
  } catch (error) {
    console.error("[GET /api/batches]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}
