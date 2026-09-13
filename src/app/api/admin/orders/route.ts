import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { orderStatusUpdateSchema } from "@/lib/validation";
import { assertValidTransition } from "@/lib/order-state-machine";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized." } }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") ?? "1");
    const limit = parseInt(searchParams.get("limit") ?? "20");
    const status = searchParams.get("status") ?? undefined;
    const paymentStatus = searchParams.get("paymentStatus") ?? undefined;
    const campaignId = searchParams.get("campaignId") ?? undefined;
    const search = searchParams.get("search") ?? undefined;

    const skip = (page - 1) * limit;

    // Build search filter
    const searchFilter = search
      ? {
          OR: [
            { reference: { contains: search, mode: "insensitive" as const } },
            {
              customerSnapshot: {
                path: ["fullName"],
                string_contains: search,
              },
            },
            {
              customerSnapshot: {
                path: ["mobileNumber"],
                string_contains: search,
              },
            },
          ],
        }
      : {};

    const where = {
      ...(status && { status: status as never }),
      ...(paymentStatus && { paymentStatus: paymentStatus as never }),
      ...(campaignId && { campaignId }),
      ...searchFilter,
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          campaign: { select: { name: true, slug: true } },
          paymentMethod: { select: { name: true } },
          items: {
            select: {
              quantity: true,
              productNameSnapshot: true,
              variantSnapshot: true,
              unitPriceAtPurchase: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        orders,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/orders]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
