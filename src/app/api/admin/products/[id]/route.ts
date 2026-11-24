import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { productUpdateSchema } from "@/lib/validation";
import { uniqueViolationTarget } from "@/lib/prisma-errors";
import { syncProductColorImages, ColorImageSyncError } from "@/lib/product-color-image-sync";
import { releaseOrderCapacity } from "@/lib/order-service";
import { revalidateStorefront } from "@/lib/storefront-cache";
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
      include: {
        variants: { orderBy: [{ color: "asc" }, { size: "asc" }] },
        colorImages: { orderBy: [{ colorKey: "asc" }, { sortOrder: "asc" }] },
      },
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
    const { variants, images, colorImages, removeColorImages, ...columns } = parsed.data;
    if (columns.preorderLimit !== undefined && columns.preorderLimit !== null) {
      const existingProduct = await prisma.product.findUnique({
        where: { id },
        select: { preorderReserved: true },
      });
      if (!existingProduct) {
        return NextResponse.json(
          { success: false, error: { code: "NOT_FOUND", message: "Product not found." } },
          { status: 404 }
        );
      }
      if (columns.preorderLimit < existingProduct.preorderReserved) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: `Cannot set the total pre-order limit to ${columns.preorderLimit}: ${existingProduct.preorderReserved} unit(s) are already reserved. A limit cannot be set below what has been sold.`,
            },
          },
          { status: 400 }
        );
      }
    }
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
      const colorImageChanges =
        colorImages === undefined && removeColorImages === undefined
          ? null
          : await syncProductColorImages(tx, id, colorImages, removeColorImages);
      await tx.auditLog.create({
        data: {
          actor: guard.actor,
          action: "product.updated",
          newValue: {
            productId: id,
            name: product.name,
            ...(variantChanges ? { variantChanges } : {}),
            ...(colorImageChanges ? { colorImageChanges } : {}),
          },
        },
      });
      return { product, variantChanges, colorImageChanges };
    }, { maxWait: 15_000, timeout: 30_000 });
    revalidateStorefront();
    return NextResponse.json({
      success: true,
      data: result.product,
      meta: {
        variantChanges: result.variantChanges,
        colorImageChanges: result.colorImageChanges,
      },
    });
  } catch (error) {
    if (error instanceof ColorImageSyncError) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: error.message } },
        { status: 400 }
      );
    }
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
    const permanent = request.nextUrl.searchParams.get("permanent") === "true";
    if (permanent && guard.role !== "SUPER_ADMIN" && guard.role !== "ADMIN") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Only admins can permanently delete products.",
          },
        },
        { status: 403 }
      );
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findUnique({
          where: { id },
          select: { id: true, name: true, slug: true, archivedAt: true },
        });
        if (!product) {
          return { notFound: true } as const;
        }

        if (!permanent && product.archivedAt) {
          return {
            notFound: false,
            deleted: true,
            archived: true,
            autoClosedOrders: 0,
            message: `Product "${product.name}" is already in the Archive.`,
          } as const;
        }

        const variants = await tx.productVariant.findMany({
          where: { productId: id },
          select: { id: true },
        });
        const variantIds = variants.map((v) => v.id);

        if (permanent) {
          // Permanent deletion from Archive: detach OrderItem.variantId so
          // historical order items, totals, and paid receipts remain 100% intact.
          if (variantIds.length > 0) {
            await tx.orderItem.updateMany({
              where: { variantId: { in: variantIds } },
              data: { variantId: null },
            });
          }
          await tx.batchProduct.deleteMany({ where: { productId: id } });
          await tx.productColorImage.deleteMany({ where: { productId: id } });
          await tx.productVariant.deleteMany({ where: { productId: id } });
          await tx.product.delete({ where: { id } });

          await tx.auditLog.create({
            data: {
              actor: guard.actor,
              action: "product.deleted_permanently",
              oldValue: { productId: id, name: product.name, slug: product.slug },
              metadata: { role: guard.role },
            },
          });

          return {
            notFound: false,
            deleted: true,
            archived: false,
            message: `Product "${product.name}" permanently deleted. Historical order receipts were preserved.`,
          } as const;
        }

        // Default seamless delete: move product to Archive, free its URL slug,
        // remove it from live batches, and auto-close any unpaid single-item
        // intake orders that were waiting on this product alone.
        const now = new Date();
        const archivedSlug = product.slug.includes("-archived-")
          ? product.slug
          : `${product.slug.slice(0, 44)}-archived-${id.slice(-6).toLowerCase()}`;

        let autoClosedOrders = 0;
        if (variantIds.length > 0) {
          const intakeOrderItems = await tx.orderItem.findMany({
            where: {
              variantId: { in: variantIds },
              order: {
                archivedAt: null,
                paymentStatus: "UNPAID",
                status: { in: ["PENDING", "AWAITING_PAYMENT", "PAYMENT_REVIEW"] },
              },
            },
            select: { orderId: true },
          });
          const candidateOrderIds = [...new Set(intakeOrderItems.map((i) => i.orderId))];

          if (candidateOrderIds.length > 0) {
            const otherItems = await tx.orderItem.findMany({
              where: {
                orderId: { in: candidateOrderIds },
                OR: [
                  { variantId: null },
                  { variantId: { notIn: variantIds } },
                ],
              },
              select: { orderId: true },
            });
            const multiProductOrderIds = new Set(otherItems.map((i) => i.orderId));
            const singleProductOrderIds = candidateOrderIds.filter(
              (orderId) => !multiProductOrderIds.has(orderId)
            );

            for (const orderId of singleProductOrderIds) {
              const orderRow = await tx.order.findUnique({
                where: { id: orderId },
                select: { id: true, status: true },
              });
              if (!orderRow) continue;
              const claim = await tx.order.updateMany({
                where: { id: orderId, status: orderRow.status },
                data: { status: "CANCELLED", archivedAt: now },
              });
              if (claim.count === 1) {
                await releaseOrderCapacity(tx, orderId);
                await tx.orderStatusHistory.create({
                  data: {
                    orderId,
                    fromStatus: orderRow.status,
                    toStatus: "CANCELLED",
                    changedBy: guard.actor,
                    note: `Auto-closed when product "${product.name}" was archived`,
                  },
                });
                await tx.auditLog.create({
                  data: {
                    orderId,
                    actor: guard.actor,
                    action: "order.archived",
                    oldValue: { status: orderRow.status },
                    newValue: { status: "CANCELLED", archivedAt: now.toISOString() },
                    metadata: {
                      reason: `Product "${product.name}" archived`,
                      role: guard.role,
                    },
                  },
                });
                autoClosedOrders += 1;
              }
            }
          }
        }

        await tx.batchProduct.deleteMany({ where: { productId: id } });
        await tx.product.update({
          where: { id },
          data: {
            active: false,
            preorderEnabled: false,
            preorderStatus: "DISABLED",
            archivedAt: now,
            slug: archivedSlug,
          },
        });

        await tx.auditLog.create({
          data: {
            actor: guard.actor,
            action: "product.archived",
            oldValue: { productId: id, name: product.name, slug: product.slug },
            newValue: { archivedAt: now.toISOString(), autoClosedOrders },
            metadata: { role: guard.role },
          },
        });

        return {
          notFound: false,
          deleted: true,
          archived: true,
          autoClosedOrders,
          message:
            autoClosedOrders > 0
              ? `Product "${product.name}" moved to Archive (${autoClosedOrders} unpaid pending order${autoClosedOrders === 1 ? "" : "s"} auto-closed).`
              : `Product "${product.name}" moved to Archive.`,
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

    revalidateStorefront();
    return NextResponse.json({
      success: true,
      data: {
        deleted: true,
        archived: result.archived,
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

