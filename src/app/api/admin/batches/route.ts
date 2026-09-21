import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { batchWriteSchema } from "@/lib/validation";
import { slugifyBatchName } from "@/lib/batches";
import {
  assertProductsExist,
  BatchWriteError,
  normaliseBatchWrite,
  uniqueBatchSlug,
} from "@/lib/batch-service";

export async function GET(request: NextRequest) {
  try {
    const guard = await requirePermission("batches.read", request);
    if (!guard.ok) return guard.response;

    const batches = await prisma.batch.findMany({
      include: {
        products: { include: { product: { select: { id: true, name: true } } } },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // The two money columns used to cost one query per batch, so a list of
    // thirty batches was thirty-one round trips. One grouped query answers the
    // same question and cannot drift into an N+1 again.
    const tallies = await prisma.order.groupBy({
      by: ["batchId", "paymentStatus"],
      where: { batchId: { in: batches.map((b) => b.id) } },
      _sum: { total: true },
      _count: { _all: true },
    });

    const data = batches.map((b) => {
        const rows = tallies.filter((row) => row.batchId === b.id);
        const totalValue = rows.reduce((sum, row) => sum + Number(row._sum.total ?? 0), 0);
        const unpaidCount = rows
          .filter((row) => row.paymentStatus === "UNPAID")
          .reduce((sum, row) => sum + row._count._all, 0);

        return {
          id: b.id,
          name: b.name,
          slug: b.slug,
          status: b.status,
          notes: b.description,
          startAt: b.startAt ? b.startAt.toISOString() : null,
          // The screen says ETA, the column says endAt. Translated here, once,
          // because this is the boundary between the database and the operator.
          etaAt: b.endAt ? b.endAt.toISOString() : null,
          coverImage: b.coverImage,
          createdAt: b.createdAt.toISOString(),
          orderCount: b._count.orders,
          totalValue,
          unpaidCount,
          products: b.products,
        };
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[GET /api/admin/batches]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePermission("batches.write", request);
    if (!guard.ok) return guard.response;

    const body = await request.json();
    const parsed = batchWriteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid batch data.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
    }

    const data = normaliseBatchWrite(body, parsed.data);

    // The slug is derived here rather than demanded from the caller. It is part
    // of the public URL, and the screen that used to be expected to invent one
    // sent nothing — which is why every attempt to create a batch from the admin
    // panel returned "Invalid batch data" and created nothing.
    const slug = await uniqueBatchSlug(data.slug ?? slugifyBatchName(data.name ?? ""));
    const productIds = data.productIds ?? [];

    if (productIds.length > 0) await assertProductsExist(productIds);

    const batch = await prisma.batch.create({
      data: {
        name: data.name ?? "",
        slug,
        description: data.description ?? null,
        status: data.status ?? "DRAFT",
        startAt: data.startAt ?? null,
        endAt: data.endAt ?? null,
        coverImage: data.coverImage ?? null,
        products: { create: productIds.map((productId) => ({ productId })) },
      },
    });

    await prisma.auditLog.create({
      data: {
        actor: guard.actor,
        action: "batch.created",
        newValue: { batchId: batch.id, name: batch.name, slug: batch.slug },
      },
    });

    return NextResponse.json({ success: true, data: batch }, { status: 201 });
  } catch (error) {
    if (error instanceof BatchWriteError) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: error.message } }, { status: 400 });
    }
    console.error("[POST /api/admin/batches]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
