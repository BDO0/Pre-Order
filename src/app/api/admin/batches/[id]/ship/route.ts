import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import type { OrderStatus } from "@prisma/client";
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
    const updated = await prisma.$transaction(async (tx) => {
      const ordersToShip = await tx.order.findMany({
        where: {
          batchId: id,
          status: "CONFIRMED"
        },
        select: { id: true, status: true, reference: true }
      });
      if (ordersToShip.length === 0) {
        return 0;
      }
      await tx.order.updateMany({
        where: {
          batchId: id,
          status: "CONFIRMED"
        },
        data: {
          status: "SHIPPED"
        }
      });
      for (const order of ordersToShip) {
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: "SHIPPED",
            changedBy: guard.actor,
            note: "Marked as Shipped via Batch bulk action",
          },
        });
        await tx.auditLog.create({
          data: {
            orderId: order.id,
            actor: guard.actor,
            action: "order.updated",
            oldValue: { status: order.status },
            newValue: { status: "SHIPPED" },
            metadata: { note: "Marked as Shipped via Batch bulk action", role: guard.role },
          },
        });
      }
      return ordersToShip.length;
    });
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
