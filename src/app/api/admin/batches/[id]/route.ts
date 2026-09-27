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

/*
 * There is no GET handler here on purpose.
 *
 * This route used to answer `GET /api/admin/batches/[id]` with the raw Prisma row,
 * while `GET /api/admin/batches` answers with a mapped row - `notes` for
 * `description`, `etaAt` for `endAt`, plus the order tallies - so one batch had
 * two shapes depending on which URL a caller used, and only one of them matched
 * what the admin screen renders. Nothing called this one; the batch screen reads
 * the list. That makes the list route the single source for batch reads, which is
 * the same choice that removed the duplicate `/api/admin/campaigns` tree.
 */

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
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid batch data.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
    }

    const data = normaliseBatchWrite(body, parsed.data);
    if (isEmptyBatchWrite(data)) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Nothing to update." } }, { status: 400 });
    }

    const existing = await prisma.batch.findUnique({
      where: { id },
      select: { id: true, slug: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Batch not found." } }, { status: 404 });
    }

    const { productIds, ...columns } = data;
    if (productIds) await assertProductsExist(productIds);

    // A slug that was sent is honoured (and de-duplicated against the others);
    // one that was not sent is left alone, so renaming a batch cannot break a
    // link the operator has already shared with customers.
    if (columns.slug) {
      columns.slug = await uniqueBatchSlug(columns.slug, id);
    }

    // Only the keys the request actually carried are written.
    //
    // This is the whole fix. The previous version wrote every column on every
    // call — `description: description || null`, `endAt: endAt ? … : null` — so
    // renaming a batch from a screen that manages a name, a note and a date
    // silently deleted the description, the start date, the ETA and the cover
    // image. The ETA badge then vanished, which is how it was noticed.
    const updated = await prisma.$transaction(async (tx) => {
      const batch = await tx.batch.update({ where: { id }, data: columns });

      // Products are swapped in the same transaction: a failure between the
      // delete and the insert would otherwise leave the batch with none, and
      // every order already placed against it would be unfulfillable.
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
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: error.message } }, { status: 400 });
    }
    console.error("[PATCH /api/admin/batches/[id]]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
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

    // Safety: a batch is what tells a supplier what to make. Deleting one would
    // leave its orders ungrouped and easy to forget, so it must be archived.
    const orderCount = await prisma.order.count({ where: { batchId: id } });
    if (orderCount > 0) {
      return NextResponse.json({
        success: false,
        error: { code: "CONFLICT", message: `Cannot delete: this batch has ${orderCount} order(s). Edit it and set its status to ARCHIVED instead.` }
      }, { status: 409 });
    }

    const existing = await prisma.batch.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Batch not found." } }, { status: 404 });
    }

    const deleted = await prisma.$transaction(async (tx) => {
      await tx.batchProduct.deleteMany({ where: { batchId: id } });
      const batch = await tx.batch.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          actor: guard.actor,
          action: "batch.deleted",
          oldValue: { batchId: id, name: batch.name, slug: batch.slug },
        },
      });

      return batch;
    });

    return NextResponse.json({ success: true, data: { id: deleted.id } });
  } catch (error) {
    console.error("[DELETE /api/admin/batches/[id]]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
