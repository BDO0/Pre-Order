import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";

/**
 * DELETE /api/admin/orders/cancelled
 * Permanently deletes all CANCELLED and REJECTED orders.
 * Optionally scoped to a single batch via ?batchId=<id>.
 *
 * Requires orders.update permission (ADMIN / SUPER_ADMIN / ORDER_MANAGER).
 * Stock has already been released when the order was cancelled, so hard-deleting
 * these rows is safe.
 */
export async function DELETE(request: NextRequest) {
  try {
    const guard = await requirePermission("orders.update", request);
    if (!guard.ok) return guard.response;

    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId") ?? undefined;

    // Safety: only delete truly terminal statuses
    const where = {
      status: { in: ["CANCELLED", "REJECTED"] as ("CANCELLED" | "REJECTED")[] },
      ...(batchId ? { batchId } : {}),
    };

    // Prisma cascade rules: orderItems, statusHistory, auditLogs
    // must be deleted first because they reference orders.
    const targets = await prisma.order.findMany({
      where,
      select: { id: true },
    });
    const ids = targets.map((o) => o.id);

    if (ids.length === 0) {
      return NextResponse.json({ success: true, data: { deleted: 0 } });
    }

    // Delete in dependency order inside a transaction
    await prisma.$transaction([
      prisma.auditLog.deleteMany({ where: { orderId: { in: ids } } }),
      prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } }),
      prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } }),
      prisma.order.deleteMany({ where: { id: { in: ids } } }),
    ]);

    // Audit the bulk action itself (no orderId since orders are gone)
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
