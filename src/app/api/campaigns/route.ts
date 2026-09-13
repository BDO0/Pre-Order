import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(request, RATE_LIMITS.publicRead);
    if (limited) return limited;

    const now = new Date();

    const campaigns = await prisma.campaign.findMany({
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

    // Auto-close campaigns where endAt has passed (check-on-request)
    const openCampaigns = campaigns.filter((c) => {
      if (c.endAt && now > c.endAt) return false;
      if (c.startAt && now < c.startAt) return false;
      return true;
    });

    return NextResponse.json({ success: true, data: openCampaigns });
  } catch (error) {
    console.error("[GET /api/campaigns]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}
