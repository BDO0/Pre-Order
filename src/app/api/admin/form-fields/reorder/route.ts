import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { formFieldReorderSchema } from "@/lib/validation";

export async function PATCH(request: NextRequest) {
  try {
    const guard = await requirePermission("settings.write", request);
    if (!guard.ok) return guard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid request body." } },
        { status: 400 }
      );
    }

    const parsed = formFieldReorderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Order must be an array of field IDs." } },
        { status: 400 }
      );
    }

    const order = [...new Set(parsed.data.order)];

    const known = await prisma.orderFormField.findMany({
      where: { id: { in: order } },
      select: { id: true },
    });
    if (known.length !== order.length) {
      const present = new Set(known.map((field) => field.id));
      const missing = order.filter((id) => !present.has(id));
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: `Unknown question id${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Reload the page and try again.`,
          },
        },
        { status: 400 }
      );
    }

    await prisma.$transaction(
      order.map((id, index) =>
        prisma.orderFormField.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    );

    const reordered = await prisma.orderFormField.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json({ success: true, data: reordered });
  } catch (error) {
    console.error("[PATCH /api/admin/form-fields/reorder]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to reorder form fields." } },
      { status: 500 }
    );
  }
}
