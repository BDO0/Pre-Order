import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { productSchema } from "@/lib/validation";

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
    const parsed = productSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid product data.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
    }

    const product = await prisma.product.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description,
        category: parsed.data.category,
        price: parsed.data.price,
        preorderEnabled: parsed.data.preorderEnabled,
        preorderStatus: parsed.data.preorderStatus,
        preorderStartAt: parsed.data.preorderStartAt ? new Date(parsed.data.preorderStartAt) : null,
        preorderEndAt: parsed.data.preorderEndAt ? new Date(parsed.data.preorderEndAt) : null,
        preorderLimit: parsed.data.preorderLimit,
        images: body.images || [],
        variants: {
          create: Array.isArray(body.variants) ? body.variants : [],
        }
      },
    });

    await prisma.auditLog.create({
      data: {
        actor: guard.actor,
        action: "product.created",
        newValue: { productId: product.id, name: product.name },
      },
    });

    return NextResponse.json({ success: true, data: product }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/products]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
