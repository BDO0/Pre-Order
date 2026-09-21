import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { productUpdateSchema } from "@/lib/validation";
import { ensureProductInOpenBatch } from "@/lib/batch-service";
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
    const body = await request.json();
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

    // The whole edit in one transaction.
    //
    // The product row used to be written first and the variants second, so a
    // failure in the variant half (Postgres refusing to delete a variant that an
    // order refers to) answered with a 500 from a form whose name and price had
    // in fact been saved. Neither half can land without the other now.
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: {
          ...columns,
          // Two names for one intent: `preorderEnabled` is what the storefront
          // and the order service check, `preorderStatus` is what the operator
          // sets. Only a status that was actually sent moves them.
          ...(columns.preorderStatus !== undefined
            ? { preorderEnabled: columns.preorderStatus !== "DISABLED" }
            : {}),
          ...(images ? { images } : {}),
        },
      });

      // `undefined` means the screen did not send a variant list, which is not
      // the same as sending an empty one. An empty list is honoured: it retires
      // every variant, which is what "these are the sizes now" means when the
      // operator has cleared the field.
      const variantChanges =
        variants === undefined ? null : await syncProductVariants(tx, id, variants);

      // A product that belongs to no batch cannot be ordered at all, because the
      // order service requires the join. Creating a product links it to the open
      // batch; editing one did not, which is why the storefront page used to
      // press the missing join in while a customer was reading it.
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

    // Check if product has ordered items
    const orderItemsCount = await prisma.orderItem.count({
      where: { variant: { productId: id } },
    });

    if (orderItemsCount > 0) {
      // Soft-delete by setting active: false and preorderEnabled: false
      await prisma.product.update({
        where: { id },
        data: { active: false, preorderEnabled: false, preorderStatus: "DISABLED" },
      });
      return NextResponse.json({
        success: true,
        data: { archived: true, message: "Product has past orders. It has been deactivated." },
      });
    }

    await prisma.batchProduct.deleteMany({ where: { productId: id } });
    await prisma.productVariant.deleteMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } });

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error) {
    console.error("[DELETE /api/admin/products/[id]]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR" } }, { status: 500 });
  }
}
