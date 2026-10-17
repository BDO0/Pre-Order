import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { batchUpdateSchema } from "@/lib/validation";
import {
  assertProductsExist,
  BatchWriteError,
  isEmptyBatchWrite,
  normaliseBatchWrite,
  syncBatchProducts,
  uniqueBatchSlug,
} from "@/lib/batch-service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePermission("batches.write", request);
    if (!guard.ok) return guard.response;
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = batchUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid batch data.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 }
      );
    }
    const data = normaliseBatchWrite(body, parsed.data);
    if (isEmptyBatchWrite(data)) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Nothing to update." } },
        { status: 400 }
      );
    }
    const existing = await prisma.batch.findUnique({
      where: { id },
      select: { id: true, slug: true },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Batch not found." } },
        { status: 404 }
      );
    }
    const { productIds, ...columns } = data;
    if (productIds) await assertProductsExist(productIds);
    if (columns.slug) {
      columns.slug = await uniqueBatchSlug(columns.slug, id);
    }
    const updated = await prisma.$transaction(async (tx) => {
      const batch = await tx.batch.update({ where: { id }, data: columns });
      if (productIds) await syncBatchProducts(tx, id, productIds);
      await tx.auditLog.create({
        data: {
          actor: guard.actor,
          action: "batch.updated",
          oldValue: { slug: existing.slug },
          newValue: { batchId: id, ...columns, ...(productIds ? { productIds } : {}) },
        },
      });
      return batch;
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof BatchWriteError) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: error.message } },
        { status: 400 }
      );
    }
    console.error("[PATCH /api/admin/batches/[id]]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePermission("batches.write", request);
    if (!guard.ok) return guard.response;
    const { id } = await params;

    const existing = await prisma.batch.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Batch not found." } },
        { status: 404 }
      );
    }

    await prisma.$transaction(
      async (tx) => {
        const orders = await tx.order.findMany({
          where: { batchId: id },
          select: { id: true },
        });
        const orderIds = orders.map((o) => o.id);

        if (orderIds.length > 0) {
          await tx.auditLog.deleteMany({ where: { orderId: { in: orderIds } } });
          await tx.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
          await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
          await tx.order.deleteMany({ where: { id: { in: orderIds } } });
        }

        await tx.batchProduct.deleteMany({ where: { batchId: id } });
        await tx.batch.delete({ where: { id } });
      },
      { maxWait: 15_000, timeout: 30_000 }
    );

    return NextResponse.json({
      success: true,
      data: { deleted: true, id, name: existing.name },
    });
  } catch (error) {
    console.error("[DELETE /api/admin/batches/[id]]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to delete batch." } },
      { status: 500 }
    );
  }
}