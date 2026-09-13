import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

// Public endpoint — no auth required
// Returns active payment methods for display in the customer checkout form
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(request, RATE_LIMITS.publicRead);
    if (limited) return limited;

    const methods = await prisma.paymentMethod.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        instructions: true,
        accountName: true,
        accountNumber: true,
        requiresProof: true,
        sortOrder: true,
      },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json({ success: true, data: methods });
  } catch (error) {
    console.error("[GET /api/payment-methods]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}
