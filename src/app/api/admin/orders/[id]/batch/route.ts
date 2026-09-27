import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePermission("orders.update", request);
    if (!guard.ok) return guard.response;
    const { id } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid request body." } },
        { status: 400 }
      );
    }
    const batchId = (body as { batchId?: unknown } | null)?.batchId;
    if (typeof batchId !== "string" || batchId === "") {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Choose a batch for this order." } },
        { status: 400 }
      );
    }
    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, batchId: true },
    });
    if (!order) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Order not found." } },
        { status: 404 }
      );
    }
    const targetBatch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true },
    });
    if (!targetBatch) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Batch not found." } },
        { status: 404 }
      );
    }
    const updated = await prisma.$transaction(async (tx) => {
      const moved = await tx.order.update({
        where: { id },
        data: { batchId },
        include: {
          batch: { select: { id: true, name: true } },
        },
      });
      await tx.auditLog.create({
        data: {
          orderId: id,
          actor: guard.actor,
          action: "order.batch_updated",
          oldValue: { batchId: order.batchId },
          newValue: { batchId: moved.batchId, batchName: moved.batch.name },
        },
      });
      return moved;
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("[PATCH /api/admin/orders/[id]/batch]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}
