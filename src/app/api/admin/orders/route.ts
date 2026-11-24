import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { hasPermission } from "@/lib/permissions";
import { buildOrderWhere } from "@/lib/order-filters";
import { redactCustomerSnapshot, REDACTED_FIELD } from "@/lib/redaction";

export async function GET(request: NextRequest) {
  try {
    const guard = await requirePermission("orders.read", request);
    if (!guard.ok) return guard.response;
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1") || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20") || 20));
    const skip = (page - 1) * limit;
    const where = buildOrderWhere(searchParams);
    const batchId = searchParams.get("batchId") ?? undefined;
    const canReadCustomer = hasPermission(guard.role, "customers.read");

    const [rawOrders, total, statusPaymentGroups] = await Promise.all([
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
      prisma.order.groupBy({
        by: ["status", "paymentStatus"],
        where: { archivedAt: null, ...(batchId ? { batchId } : {}) },
        _count: { _all: true },
      }),
    ]);

    const orders = canReadCustomer
      ? rawOrders
      : rawOrders.map((o) => ({
          ...o,
          customerSnapshot: redactCustomerSnapshot(
            o.customerSnapshot as Record<string, unknown> | null,
            new Set()
          ),
          customer: o.customer
            ? {
                ...o.customer,
                instagramHandle: o.customer.instagramHandle ? REDACTED_FIELD : null,
              }
            : null,
        }));

    const counts = {
      all: 0,
      new: 0,
      awaitingPayment: 0,
      approvedPaid: 0,
      fulfillment: 0,
      shipped: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const g of statusPaymentGroups) {
      const n = g._count._all;
      counts.all += n;
      if (g.status === "PENDING") counts.new += n;
      if (
        g.status === "AWAITING_PAYMENT" ||
        g.status === "PAYMENT_REVIEW" ||
        (g.status === "CONFIRMED" && g.paymentStatus === "UNPAID")
      ) {
        counts.awaitingPayment += n;
      }
      if (g.status === "CONFIRMED" && g.paymentStatus === "PAID") {
        counts.approvedPaid += n;
      }
      if (g.status === "PROCESSING" || g.status === "READY") {
        counts.fulfillment += n;
      }
      if (g.status === "SHIPPED") counts.shipped += n;
      if (g.status === "COMPLETED") counts.completed += n;
      if (g.status === "CANCELLED" || g.status === "REJECTED") {
        counts.cancelled += n;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        orders,
        counts,
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
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}
