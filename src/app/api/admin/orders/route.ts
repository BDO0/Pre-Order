import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { buildOrderWhere } from "@/lib/order-filters";
export async function GET(request: NextRequest) {
  try {
    const guard = await requirePermission("orders.read", request);
    if (!guard.ok) return guard.response;
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") ?? "1");
    const limit = parseInt(searchParams.get("limit") ?? "20");
    const skip = (page - 1) * limit;
    const where = buildOrderWhere(searchParams);
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          batch: { select: { id: true, name: true, slug: true, status: true } },
          customer: { select: { id: true, instagramHandle: true } },
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
