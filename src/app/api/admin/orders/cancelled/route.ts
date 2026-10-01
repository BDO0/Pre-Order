import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";

export async function DELETE(request: NextRequest) {
  try {
    const guard = await requirePermission("orders.update", request);
    if (!guard.ok) return guard.response;

    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId") ?? undefined;

    const where = {
      status: { in: ["CANCELLED", "REJECTED"] as ("CANCELLED" | "REJECTED")[] },
      ...(batchId ? { batchId } : {}),
    };

    const targets = await prisma.order.findMany({
      where,
      select: { id: true },
    });
    const ids = targets.map((o) => o.id);

    if (ids.length === 0) {
      return NextResponse.json({ success: true, data: { deleted: 0 } });
    }

    await prisma.$transaction([
      prisma.auditLog.deleteMany({ where: { orderId: { in: ids } } }),
      prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } }),
      prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } }),
      prisma.order.deleteMany({ where: { id: { in: ids } } }),
    ]);

    await prisma.auditLog.create({
      data: {
        actor: guard.actor,
        action: "orders.bulk_deleted_cancelled",
        newValue: { count: ids.length, batchId: batchId ?? "all" },
      },
    });

    return NextResponse.json({ success: true, data: { deleted: ids.length } });
  } catch (error) {
    console.error("[DELETE /api/admin/orders/cancelled]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}
