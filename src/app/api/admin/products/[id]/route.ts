import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { productUpdateSchema } from "@/lib/validation";
import { ensureProductInOpenBatch } from "@/lib/batch-service";
import { uniqueViolationTarget } from "@/lib/prisma-errors";
import { syncProductVariants, VariantSyncError } from "@/lib/product-variants";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePermission("products.read", request);
    if (!guard.ok) return guard.response;
    const { id } = await params;
    const product = await prisma.product.findUnique({
      where: { id },
      include: { variants: { orderBy: [{ color: "asc" }, { size: "asc" }] } },
    });
    if (!product) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Product not found." } }, { status: 404 });
    return NextResponse.json({ success: true, data: product });
  } catch (error) {
    console.error("[GET /api/admin/products/[id]]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR" } }, { status: 500 });
  }
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePermission("products.write", request);
    if (!guard.ok) return guard.response;
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = productUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: issue ? issue.message : "Invalid product data.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 }
      );
    }
    const { variants, images, ...columns } = parsed.data;
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: {
          ...columns,
          ...(columns.preorderStatus !== undefined
            ? { preorderEnabled: columns.preorderStatus !== "DISABLED" }
            : {}),
          ...(images ? { images } : {}),
        },
      });
      const variantChanges =
        variants === undefined ? null : await syncProductVariants(tx, id, variants);
      const batchId = await ensureProductInOpenBatch(tx, id);
      await tx.auditLog.create({
        data: {
          actor: guard.actor,
          action: "product.updated",
          newValue: {
            productId: id,
            name: product.name,
            ...(variantChanges ? { variantChanges } : {}),
          },
        },
      });
      return { product, variantChanges, batchId };
    });
    return NextResponse.json({
      success: true,
      data: result.product,
      meta: { batchId: result.batchId, variantChanges: result.variantChanges },
    });
  } catch (error) {
    if (error instanceof VariantSyncError) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: error.message } },
        { status: 400 }
      );
    }
    if (uniqueViolationTarget(error)?.includes("slug")) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "SLUG_TAKEN",
            message: "Another product already uses that URL slug. Pick a different one.",
          },
        },
        { status: 409 }
      );
    }
    console.error("[PATCH /api/admin/products/[id]]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePermission("products.write", request);
    if (!guard.ok) return guard.response;
    const { id } = await params;

    const result = await prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findUnique({
          where: { id },
          select: { id: true, name: true, slug: true },
        });
        if (!product) {
          return { notFound: true } as const;
        }

        const variants = await tx.productVariant.findMany({
          where: { productId: id },
          select: { id: true },
        });
        const variantIds = variants.map((v) => v.id);

        if (variantIds.length > 0) {
          const orderItems = await tx.orderItem.findMany({
            where: { variantId: { in: variantIds } },
            select: { orderId: true },
          });
          const affectedOrderIds = [...new Set(orderItems.map((i) => i.orderId))];

          // Delete all order items for this product's variants in bulk
          await tx.orderItem.deleteMany({
            where: { variantId: { in: variantIds } },
          });

          // Delete any orders that are now empty in bulk, and recalculate totals for orders with remaining items
          if (affectedOrderIds.length > 0) {
            const ordersStillWithItems = await tx.orderItem.findMany({
              where: { orderId: { in: affectedOrderIds } },
              select: { orderId: true, quantity: true, unitPriceAtPurchase: true },
            });
            const keepOrderIds = new Set(ordersStillWithItems.map((o) => o.orderId));
            const ordersToDelete = affectedOrderIds.filter((orderId) => !keepOrderIds.has(orderId));

            if (ordersToDelete.length > 0) {
              await tx.auditLog.deleteMany({ where: { orderId: { in: ordersToDelete } } });
              await tx.orderStatusHistory.deleteMany({ where: { orderId: { in: ordersToDelete } } });
              await tx.order.deleteMany({ where: { id: { in: ordersToDelete } } });
            }

            // Recalculate totals for surviving orders so price matches the remaining items
            for (const orderId of keepOrderIds) {
              const remainingItems = ordersStillWithItems.filter((item) => item.orderId === orderId);
              const newSubtotal = remainingItems.reduce(
                (sum, item) => sum + Number(item.unitPriceAtPurchase) * item.quantity,
                0
              );
              await tx.order.update({
                where: { id: orderId },
                data: {
                  subtotal: newSubtotal,
                  total: newSubtotal,
                },
              });
              await tx.auditLog.create({
                data: {
                  orderId,
                  actor: guard.actor,
                  action: "order.recalculated",
                  newValue: {
                    subtotal: newSubtotal.toString(),
                    total: newSubtotal.toString(),
                    reason: `Recalculated after product "${product.name}" was deleted`,
                  },
                  metadata: { role: guard.role },
                },
              });
            }
          }
        }

        await tx.batchProduct.deleteMany({ where: { productId: id } });
        await tx.productVariant.deleteMany({ where: { productId: id } });
        await tx.product.delete({ where: { id } });

        return {
          notFound: false,
          deleted: true,
          message: `Product "${product.name}" deleted permanently.`,
        } as const;
      },
      { maxWait: 15_000, timeout: 30_000 }
    );

    if (result.notFound) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Product not found." } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        deleted: true,
        message: result.message,
      },
    });
  } catch (error) {
    console.error("[DELETE /api/admin/products/[id]]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to delete product." } },
      { status: 500 }
    );
  }
}

