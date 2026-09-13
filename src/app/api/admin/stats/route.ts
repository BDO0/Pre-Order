import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized." } }, { status: 401 });

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const [
      totalOrders,
      todayOrders,
      pendingOrders,
      paymentReviewOrders,
      confirmedOrders,
      completedOrders,
      cancelledOrders,
      activeCampaigns,
      pendingPaymentOrders,
      // Revenue: sum of totals for CONFIRMED+ orders
      confirmedRevenue,
      grossOrderValue,
    ] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.order.count({ where: { status: "PENDING" } }),
      prisma.order.count({ where: { status: "PAYMENT_REVIEW" } }),
      prisma.order.count({ where: { status: "CONFIRMED" } }),
      prisma.order.count({ where: { status: "COMPLETED" } }),
      prisma.order.count({ where: { status: "CANCELLED" } }),
      prisma.campaign.count({ where: { status: "OPEN" } }),
      prisma.order.count({ where: { paymentStatus: "PENDING_REVIEW" } }),
      prisma.order.aggregate({
        _sum: { total: true },
        where: { status: { in: ["CONFIRMED", "PROCESSING", "READY", "SHIPPED", "COMPLETED"] } },
      }),
      prisma.order.aggregate({
        _sum: { total: true },
        where: { status: { notIn: ["CANCELLED", "REJECTED"] } },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        totalOrders,
        todayOrders,
        pendingOrders,
        paymentReviewOrders,
        confirmedOrders,
        completedOrders,
        cancelledOrders,
        activeCampaigns,
        pendingPaymentOrders,
        confirmedRevenue: confirmedRevenue._sum.total ?? 0,
        grossOrderValue: grossOrderValue._sum.total ?? 0,
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/stats]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
