import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { ensureProductInOpenBatch } from "@/lib/batch-service";
import { uniqueViolationTarget } from "@/lib/prisma-errors";
import { productCreateSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    const guard = await requirePermission("products.read", request);
    if (!guard.ok) return guard.response;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") ?? "1");
    const limit = parseInt(searchParams.get("limit") ?? "20");
    const search = searchParams.get("search") ?? undefined;

    const where = search
      ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { category: { contains: search, mode: "insensitive" as const } }] }
      : {};

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { variants: { orderBy: [{ color: "asc" }, { size: "asc" }] } },
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    return NextResponse.json({ success: true, data: { products, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
  } catch (error) {
    console.error("[GET /api/admin/products]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePermission("products.write", request);
    if (!guard.ok) return guard.response;

    const body = await request.json();
    const parsed = productCreateSchema.safeParse(body);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: issue ? issue.message : "Invalid product data.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
    }

    const { variants, images, ...columns } = parsed.data;

    // The variant rows are built here rather than handed to Prisma as they
    // arrived. A raw `body.variants` used to be pushed straight into a nested
    // create: a capacity sent as a string, or any key the table does not have,
    // came back as an unhandled Prisma error - a 500 for what is really a bad
    // request.
    const variantRows = (variants ?? []).map((variant) => ({
      size: variant.size ?? null,
      color: variant.color ?? null,
      // A variant that has just been created has consumed nothing, so its
      // remaining capacity is its capacity - the same rule the edit path applies.
      capacity: variant.capacity ?? null,
      remainingCapacity: variant.capacity ?? null,
    }));

    // The product, its variants, its batch link and its audit entry land together
    // or not at all. The batch link used to be a separate best-effort write whose
    // failure was swallowed, and a product with no batch link is one a customer
    // can see but cannot order.
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name: columns.name,
          slug: columns.slug,
          description: columns.description,
          category: columns.category,
          price: columns.price,
          currency: columns.currency,
          preorderEnabled: columns.preorderEnabled,
          preorderStatus: columns.preorderStatus,
          preorderStartAt: columns.preorderStartAt ? new Date(columns.preorderStartAt) : null,
          preorderEndAt: columns.preorderEndAt ? new Date(columns.preorderEndAt) : null,
          preorderLimit: columns.preorderLimit,
          images: images ?? [],
          variants: { create: variantRows },
        },
      });

      // Automatically link to the open batch so the product is live on the
      // storefront - and orderable, because the order service requires the join.
      await ensureProductInOpenBatch(tx, created.id);

      await tx.auditLog.create({
        data: {
          actor: guard.actor,
          action: "product.created",
          newValue: { productId: created.id, name: created.name },
        },
      });

      return created;
    });

    return NextResponse.json({ success: true, data: product }, { status: 201 });
  } catch (error) {
    // `products.slug` is the only unique column this write can collide with, and
    // a duplicate slug is an operator typo, not a server fault: it used to come
    // back as "Something went wrong." on a form that had just been filled in.
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

    console.error("[POST /api/admin/products]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
