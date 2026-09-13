import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";

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
    const { name, category, price, active, preorderStatus, variants } = body;

    if (!name || name.trim().length < 2) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Product name is required." } }, { status: 400 });
    }

    if (!price || isNaN(Number(price)) || Number(price) <= 0) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Valid price is required." } }, { status: 400 });
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        name: name.trim(),
        category: category || null,
        price: Number(price),
        active: active ?? true,
        preorderEnabled: preorderStatus !== "DISABLED",
        preorderStatus: preorderStatus || "OPEN",
      },
    });

    // Sync variants if provided — delete all and recreate
    if (Array.isArray(variants) && variants.length > 0) {
      await prisma.productVariant.deleteMany({ where: { productId: id } });
      await prisma.productVariant.createMany({
        data: variants.map((v: { size?: string; color?: string; capacity?: number }) => ({
          productId: id,
          size: v.size || null,
          color: v.color || null,
          capacity: v.capacity ? Number(v.capacity) : null,
          remainingCapacity: v.capacity ? Number(v.capacity) : null,
          active: true,
        })),
      });
    }

    await prisma.auditLog.create({
      data: {
        actor: guard.actor,
        action: "product.updated",
        newValue: { productId: id, name },
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("[PATCH /api/admin/products/[id]]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
