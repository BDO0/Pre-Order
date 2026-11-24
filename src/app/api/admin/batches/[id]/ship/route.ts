import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePermission("orders.update", request);
    if (!guard.ok) return guard.response;
    const { id } = await params;
    const batch = await prisma.batch.findUnique({
      where: { id },
      select: { id: true, name: true }
    });
    if (!batch) {
      return NextResponse.json({ success: false, error: { code: "BATCH_NOT_FOUND", message: "Batch not found." } }, { status: 404 });
    }
    const updated = await prisma.$transaction(
      async (tx) => {
        const ordersToShip = await tx.order.findMany({
          where: {
            batchId: id,
            status: "CONFIRMED",
          },
          select: { id: true, status: true, reference: true },
        });
        if (ordersToShip.length === 0) {
          return 0;
        }
        const orderIds = ordersToShip.map((o) => o.id);
        await tx.order.updateMany({
          where: {
            id: { in: orderIds },
            status: "CONFIRMED",
          },
          data: {
            status: "SHIPPED",
          },
        });
        await tx.orderStatusHistory.createMany({
          data: ordersToShip.map((order) => ({
            orderId: order.id,
            fromStatus: order.status,
            toStatus: "SHIPPED" as const,
            changedBy: guard.actor,
            note: "Marked as Shipped via Batch bulk action",
          })),
        });
        await tx.auditLog.createMany({
          data: ordersToShip.map((order) => ({
            orderId: order.id,
            actor: guard.actor,
            action: "order.updated",
            oldValue: { status: order.status },
            newValue: { status: "SHIPPED" },
            metadata: {
              note: "Marked as Shipped via Batch bulk action",
              role: guard.role,
            },
          })),
        });
        return ordersToShip.length;
      },
      { maxWait: 15_000, timeout: 30_000 }
    );
    return NextResponse.json({
      success: true,
      data: {
        updatedCount: updated
      }
    });
  } catch (error) {
    console.error("[POST /api/admin/batches/[id]/ship]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
