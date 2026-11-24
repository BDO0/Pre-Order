import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { batchUpdateSchema } from "@/lib/validation";
import type { OrderStatus } from "@prisma/client";
import {
  releaseOrderCapacity,
  shouldAutoCloseOnArchive,
  shouldReleaseCapacityOnPermanentDelete,
} from "@/lib/order-service";
import { revalidateStorefront } from "@/lib/storefront-cache";
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
    // The batch's window, name or product list is printed on the storefront, and
    // the listing is ISR - without this the change takes up to a minute to show.
    revalidateStorefront();
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
    const permanent = request.nextUrl.searchParams.get("permanent") === "true";
    if (permanent && guard.role !== "SUPER_ADMIN" && guard.role !== "ADMIN") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Only admins can permanently delete batches.",
          },
        },
        { status: 403 }
      );
    }

    const existing = await prisma.batch.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, status: true, archivedAt: true },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Batch not found." } },
        { status: 404 }
      );
    }

    if (permanent) {
      await prisma.$transaction(
        async (tx) => {
          const orders = await tx.order.findMany({
            where: { batchId: id },
            select: { id: true, status: true },
          });
          const orderIds = orders.map((o) => o.id);

          if (orderIds.length > 0) {
            for (const order of orders) {
              if (shouldReleaseCapacityOnPermanentDelete(order.status)) {
                await releaseOrderCapacity(tx, order.id);
              }
            }
            await tx.auditLog.deleteMany({ where: { orderId: { in: orderIds } } });
            await tx.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
            await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
            await tx.order.deleteMany({ where: { id: { in: orderIds } } });
          }

          await tx.batchProduct.deleteMany({ where: { batchId: id } });
          await tx.batch.delete({ where: { id } });

          await tx.auditLog.create({
            data: {
              actor: guard.actor,
              action: "batch.deleted_permanently",
              oldValue: { batchId: id, name: existing.name, slug: existing.slug },
              metadata: { role: guard.role, deletedOrders: orderIds.length },
            },
          });
        },
        { maxWait: 15_000, timeout: 30_000 }
      );

      revalidateStorefront();
      revalidatePath(`/preorder/${existing.slug}`);

      return NextResponse.json({
        success: true,
        data: { deleted: true, archived: false, id, name: existing.name },
      });
    }

    if (existing.archivedAt) {
      return NextResponse.json({
        success: true,
        data: {
          deleted: true,
          archived: true,
          id,
          name: existing.name,
          message: `Batch "${existing.name}" is already in the Archive.`,
        },
      });
    }

    // Default seamless delete: move batch and its orders to Archive, free the
    // batch slug, and auto-close only unpaid pre-acceptance intake orders.
    const now = new Date();
    const archivedSlug = existing.slug.includes("-archived-")
      ? existing.slug
      : `${existing.slug.slice(0, 44)}-archived-${id.slice(-6).toLowerCase()}`;

    await prisma.$transaction(
      async (tx) => {
        const orders = await tx.order.findMany({
          where: { batchId: id, archivedAt: null },
          select: { id: true, status: true, paymentStatus: true },
        });

        for (const order of orders) {
          if (shouldAutoCloseOnArchive(order)) {
            const claim = await tx.order.updateMany({
              where: { id: order.id, status: order.status as OrderStatus },
              data: { status: "CANCELLED", archivedAt: now },
            });
            if (claim.count === 1) {
              await releaseOrderCapacity(tx, order.id);
              await tx.orderStatusHistory.create({
                data: {
                  orderId: order.id,
                  fromStatus: order.status as OrderStatus,
                  toStatus: "CANCELLED",
                  changedBy: guard.actor,
                  note: `Auto-closed when batch "${existing.name}" was archived`,
                },
              });
            } else {
              // Status changed concurrently (e.g. confirmed); still archive the order
              // with its batch without overwriting its new status.
              await tx.order.update({
                where: { id: order.id },
                data: { archivedAt: now },
              });
            }
          } else {
            await tx.order.update({
              where: { id: order.id },
              data: { archivedAt: now },
            });
          }
        }

        await tx.batch.update({
          where: { id },
          data: {
            status: "ARCHIVED",
            archivedAt: now,
            slug: archivedSlug,
          },
        });

        await tx.auditLog.create({
          data: {
            actor: guard.actor,
            action: "batch.archived",
            oldValue: { batchId: id, name: existing.name, slug: existing.slug, status: existing.status },
            newValue: { status: "ARCHIVED", archivedAt: now.toISOString(), archivedOrders: orders.length },
            metadata: { role: guard.role },
          },
        });
      },
      { maxWait: 15_000, timeout: 30_000 }
    );

    revalidateStorefront();
    revalidatePath(`/preorder/${existing.slug}`);

    return NextResponse.json({
      success: true,
      data: {
        deleted: true,
        archived: true,
        id,
        name: existing.name,
        message: `Batch "${existing.name}" moved to Archive.`,
      },
    });
  } catch (error) {
    console.error("[DELETE /api/admin/batches/[id]]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to delete batch." } },
      { status: 500 }
    );
  }
}