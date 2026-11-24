import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { hasPermission } from "@/lib/permissions";
import { ensureProductInOpenBatch, uniqueBatchSlug } from "@/lib/batch-service";
import { slugifyBatchName, stripArchivedSlugSuffix } from "@/lib/batches";
import { revalidateStorefront } from "@/lib/storefront-cache";
import { redactCustomerSnapshot, REDACTED_FIELD } from "@/lib/redaction";
import {
  releaseOrderCapacity,
  shouldReleaseCapacityOnPermanentDelete,
} from "@/lib/order-service";
import type { Prisma } from "@prisma/client";

async function uniqueProductSlug(desired: string, excludeId?: string): Promise<string> {
  const base = slugifyBatchName(desired) || "product";
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;
    const productClash = await prisma.product.findFirst({
      where: {
        slug: candidate,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    const batchClash = await prisma.batch.findFirst({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!productClash && !batchClash) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function GET(request: NextRequest) {
  try {
    const guard = await requirePermission("reports.read", request);
    if (!guard.ok) return guard.response;

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1") || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50") || 50));
    const search = (searchParams.get("search") ?? "").trim();

    const canReadOrders = hasPermission(guard.role, "orders.read");
    const canReadBatches = hasPermission(guard.role, "batches.read");
    const canReadProducts = hasPermission(guard.role, "products.read");
    const canReadCustomer = hasPermission(guard.role, "customers.read");

    const orderSearchFilter: Prisma.OrderWhereInput = search
      ? {
          OR: [
            { reference: { contains: search, mode: "insensitive" } },
            {
              customerSnapshot: {
                path: ["fullName"],
                string_contains: search,
              },
            },
            {
              customerSnapshot: {
                path: ["instagramHandle"],
                string_contains: search,
              },
            },
            { batch: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {};

    const orderWhere: Prisma.OrderWhereInput = {
      archivedAt: { not: null },
      ...orderSearchFilter,
    };

    const [
      archivedOrdersRaw,
      archivedOrdersMatchingTotal,
      archivedBatchesRaw,
      archivedProductsRaw,
      activeOrderStats,
      archivedOrderStats,
    ] = await Promise.all([
      canReadOrders
        ? prisma.order.findMany({
            where: orderWhere,
            include: {
              batch: { select: { id: true, name: true, slug: true, status: true } },
              customer: { select: { id: true, instagramHandle: true } },
              items: {
                select: {
                  quantity: true,
                  productNameSnapshot: true,
                  variantSnapshot: true,
                  unitPriceAtPurchase: true,
                },
              },
            },
            orderBy: { archivedAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
          })
        : Promise.resolve([]),
      canReadOrders ? prisma.order.count({ where: orderWhere }) : Promise.resolve(0),
      canReadBatches
        ? prisma.batch.findMany({
            where: { archivedAt: { not: null } },
            include: {
              products: { select: { productId: true } },
              _count: {
                select: {
                  orders: true,
                },
              },
            },
            orderBy: { archivedAt: "desc" },
            take: 200,
          })
        : Promise.resolve([]),
      canReadProducts
        ? prisma.product.findMany({
            where: { archivedAt: { not: null } },
            include: {
              variants: {
                select: {
                  id: true,
                },
              },
            },
            orderBy: { archivedAt: "desc" },
            take: 200,
          })
        : Promise.resolve([]),
      prisma.order.groupBy({
        by: ["status", "paymentStatus"],
        where: { archivedAt: null },
        _count: { id: true },
        _sum: { total: true },
      }),
      prisma.order.groupBy({
        by: ["status", "paymentStatus"],
        where: { archivedAt: { not: null } },
        _count: { id: true },
        _sum: { total: true },
      }),
    ]);

    const archivedBatchIds = archivedBatchesRaw.map((b) => b.id);
    const batchOrderTallies =
      archivedBatchIds.length > 0
        ? await prisma.order.groupBy({
            by: ["batchId", "paymentStatus", "status"],
            where: { batchId: { in: archivedBatchIds } },
            _sum: { total: true },
            _count: { _all: true },
          })
        : [];

    // M2 fix: Attribute product sales strictly by variantId when variantId is non-null.
    // Only use productNameSnapshot fallback for detached items (variantId === null)
    // when that name uniquely belongs to a single archived product (and no active product).
    const archivedProductVariantIds = archivedProductsRaw.flatMap((p) =>
      p.variants.map((v) => v.id)
    );
    const archivedProductNames = archivedProductsRaw.map((p) => p.name);

    const [productOrderItems, activeSameNameProducts] = await Promise.all([
      archivedProductsRaw.length > 0
        ? prisma.orderItem.findMany({
            where: {
              OR: [
                ...(archivedProductVariantIds.length > 0
                  ? [{ variantId: { in: archivedProductVariantIds } }]
                  : []),
                ...(archivedProductNames.length > 0
                  ? [
                      {
                        variantId: null,
                        productNameSnapshot: { in: archivedProductNames },
                      },
                    ]
                  : []),
              ],
              order: {
                status: { notIn: ["CANCELLED", "REJECTED"] },
              },
            },
            select: {
              variantId: true,
              productNameSnapshot: true,
              quantity: true,
              unitPriceAtPurchase: true,
              order: {
                select: {
                  paymentStatus: true,
                },
              },
            },
          })
        : Promise.resolve([]),
      archivedProductNames.length > 0
        ? prisma.product.findMany({
            where: {
              archivedAt: null,
              name: { in: archivedProductNames, mode: "insensitive" },
            },
            select: { name: true },
          })
        : Promise.resolve([]),
    ]);

    const activeNameSet = new Set(activeSameNameProducts.map((p) => p.name.toLowerCase()));
    const variantToProductId = new Map<string, string>();
    const archivedNameCounts = new Map<string, number>();
    const uniqueArchivedNameToProductId = new Map<string, string>();

    for (const p of archivedProductsRaw) {
      const lower = p.name.toLowerCase();
      archivedNameCounts.set(lower, (archivedNameCounts.get(lower) ?? 0) + 1);
      uniqueArchivedNameToProductId.set(lower, p.id);
      for (const v of p.variants) {
        variantToProductId.set(v.id, p.id);
      }
    }

    const productMetrics = new Map<
      string,
      { unitsOrdered: number; paidUnits: number; totalRevenue: number; paidRevenue: number }
    >();
    for (const item of productOrderItems) {
      let pid: string | undefined;
      if (item.variantId !== null) {
        pid = variantToProductId.get(item.variantId);
      } else {
        const lower = item.productNameSnapshot.toLowerCase();
        if (archivedNameCounts.get(lower) === 1 && !activeNameSet.has(lower)) {
          pid = uniqueArchivedNameToProductId.get(lower);
        }
      }
      if (!pid) continue;
      const curr = productMetrics.get(pid) ?? {
        unitsOrdered: 0,
        paidUnits: 0,
        totalRevenue: 0,
        paidRevenue: 0,
      };
      const lineValue = Number(item.unitPriceAtPurchase) * item.quantity;
      curr.unitsOrdered += item.quantity;
      curr.totalRevenue += lineValue;
      if (item.order.paymentStatus === "PAID") {
        curr.paidUnits += item.quantity;
        curr.paidRevenue += lineValue;
      }
      productMetrics.set(pid, curr);
    }

    let archivedOrdersCount = 0;
    let archivedPaidOrdersCount = 0;
    let archivedCollectedRevenue = 0;
    let archivedGrossValue = 0;
    let activeCollectedRevenue = 0;
    let activeOrdersCount = 0;
    const voided = new Set(["CANCELLED", "REJECTED"]);

    for (const g of archivedOrderStats) {
      const count = g._count.id;
      const sum = Number(g._sum.total ?? 0);
      archivedOrdersCount += count;
      if (!voided.has(g.status)) {
        archivedGrossValue += sum;
        if (g.paymentStatus === "PAID") {
          archivedCollectedRevenue += sum;
          archivedPaidOrdersCount += count;
        }
      }
    }

    for (const g of activeOrderStats) {
      const count = g._count.id;
      const sum = Number(g._sum.total ?? 0);
      activeOrdersCount += count;
      if (!voided.has(g.status) && g.paymentStatus === "PAID") {
        activeCollectedRevenue += sum;
      }
    }

    const archivedOrders = canReadCustomer
      ? archivedOrdersRaw
      : archivedOrdersRaw.map((o) => ({
          ...o,
          customerSnapshot: redactCustomerSnapshot(
            o.customerSnapshot as Record<string, unknown> | null,
            new Set()
          ),
          customer: o.customer
            ? {
                ...o.customer,
                instagramHandle: o.customer.instagramHandle ? REDACTED_FIELD : null,
              }
            : null,
        }));

    const archivedBatches = archivedBatchesRaw.map((b) => {
      const rows = batchOrderTallies.filter((r) => r.batchId === b.id);
      let paidRevenue = 0;
      let grossValue = 0;
      let validOrderCount = 0;
      let cancelledOrderCount = 0;
      for (const r of rows) {
        const sum = Number(r._sum.total ?? 0);
        const cnt = r._count._all;
        if (voided.has(r.status)) {
          cancelledOrderCount += cnt;
        } else {
          validOrderCount += cnt;
          grossValue += sum;
          if (r.paymentStatus === "PAID") {
            paidRevenue += sum;
          }
        }
      }
      return {
        id: b.id,
        name: b.name,
        slug: b.slug,
        status: b.status,
        description: b.description,
        startAt: b.startAt ? b.startAt.toISOString() : null,
        endAt: b.endAt ? b.endAt.toISOString() : null,
        archivedAt: b.archivedAt ? b.archivedAt.toISOString() : null,
        createdAt: b.createdAt.toISOString(),
        totalOrders: b._count.orders,
        validOrderCount,
        cancelledOrderCount,
        paidRevenue,
        grossValue,
        productCount: b.products.length,
      };
    });

    const archivedProducts = archivedProductsRaw.map((p) => {
      const stats = productMetrics.get(p.id) ?? {
        unitsOrdered: 0,
        paidUnits: 0,
        totalRevenue: 0,
        paidRevenue: 0,
      };
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        category: p.category,
        price: Number(p.price),
        currency: p.currency,
        images: p.images,
        archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
        variantCount: p.variants.length,
        unitsOrdered: stats.unitsOrdered,
        paidUnits: stats.paidUnits,
        totalRevenue: stats.totalRevenue,
        paidRevenue: stats.paidRevenue,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        analytics: {
          archivedOrdersCount,
          archivedPaidOrdersCount,
          archivedBatchesCount: archivedBatches.length,
          archivedProductsCount: archivedProducts.length,
          archivedCollectedRevenue,
          archivedGrossValue,
          activeOrdersCount,
          activeCollectedRevenue,
          lifetimeCollectedRevenue: activeCollectedRevenue + archivedCollectedRevenue,
        },
        orders: archivedOrders,
        ordersPagination: {
          page,
          limit,
          total: archivedOrdersMatchingTotal,
          totalPages: Math.max(1, Math.ceil(archivedOrdersMatchingTotal / limit)),
        },
        batches: archivedBatches,
        products: archivedProducts,
        capabilities: {
          manageOrders: hasPermission(guard.role, "orders.update"),
          manageBatches: hasPermission(guard.role, "batches.write"),
          manageProducts: hasPermission(guard.role, "products.write"),
          permanentDelete: guard.role === "SUPER_ADMIN" || guard.role === "ADMIN",
        },
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/archive]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to load archive." } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      type?: "order" | "batch" | "product";
      id?: string;
      action?: "restore" | "permanent_delete";
    } | null;

    const type = body?.type;
    const id = body?.id;
    const action = body?.action;

    if (
      !type ||
      !id ||
      !action ||
      !["order", "batch", "product"].includes(type) ||
      !["restore", "permanent_delete"].includes(action)
    ) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid archive action." } },
        { status: 400 }
      );
    }

    const requiredPermission =
      type === "order"
        ? "orders.update"
        : type === "batch"
        ? "batches.write"
        : "products.write";

    const guard = await requirePermission(requiredPermission, request);
    if (!guard.ok) return guard.response;

    if (action === "permanent_delete" && guard.role !== "SUPER_ADMIN" && guard.role !== "ADMIN") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Only Admins can permanently delete items from the Archive.",
          },
        },
        { status: 403 }
      );
    }

    if (type === "order") {
      const order = await prisma.order.findUnique({
        where: { id },
        select: { id: true, reference: true, status: true, batchId: true, archivedAt: true },
      });
      if (!order) {
        return NextResponse.json(
          { success: false, error: { code: "NOT_FOUND", message: "Order not found." } },
          { status: 404 }
        );
      }

      if (action === "restore") {
        if (!order.archivedAt) {
          return NextResponse.json({
            success: true,
            data: { message: `Order ${order.reference} is already in your Orders tab.` },
          });
        }
        await prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id },
            data: { archivedAt: null },
          });
          await tx.auditLog.create({
            data: {
              orderId: id,
              actor: guard.actor,
              action: "order.restored",
              newValue: { reference: order.reference, status: order.status, archivedAt: null },
              metadata: { role: guard.role },
            },
          });
        });
        const statusNote =
          order.status === "CANCELLED"
            ? " (under the Cancelled tab since its reservation was closed when archived)"
            : "";
        return NextResponse.json({
          success: true,
          data: { message: `Order ${order.reference} restored to Orders${statusNote}.` },
        });
      }

      await prisma.$transaction(async (tx) => {
        if (shouldReleaseCapacityOnPermanentDelete(order.status)) {
          await releaseOrderCapacity(tx, id);
        }
        await tx.auditLog.deleteMany({ where: { orderId: id } });
        await tx.orderStatusHistory.deleteMany({ where: { orderId: id } });
        await tx.orderItem.deleteMany({ where: { orderId: id } });
        await tx.order.delete({ where: { id } });
        await tx.auditLog.create({
          data: {
            actor: guard.actor,
            action: "order.deleted_permanently",
            oldValue: { orderId: id, reference: order.reference, status: order.status },
            metadata: { role: guard.role },
          },
        });
      });
      revalidateStorefront();
      return NextResponse.json({
        success: true,
        data: { message: `Order ${order.reference} permanently deleted.` },
      });
    }

    if (type === "batch") {
      const batch = await prisma.batch.findUnique({
        where: { id },
        select: { id: true, name: true, slug: true, status: true, archivedAt: true },
      });
      if (!batch) {
        return NextResponse.json(
          { success: false, error: { code: "NOT_FOUND", message: "Batch not found." } },
          { status: 404 }
        );
      }

      if (action === "restore") {
        if (!batch.archivedAt) {
          return NextResponse.json({
            success: true,
            data: { message: `Batch "${batch.name}" is already in your Batches tab.` },
          });
        }
        const cleanSlug = await uniqueBatchSlug(stripArchivedSlugSuffix(batch.slug), id);
        await prisma.$transaction(async (tx) => {
          await tx.batch.update({
            where: { id },
            data: {
              archivedAt: null,
              slug: cleanSlug,
              status: batch.status === "ARCHIVED" ? "CLOSED" : batch.status,
            },
          });
          await tx.order.updateMany({
            where: { batchId: id, archivedAt: { not: null } },
            data: { archivedAt: null },
          });
          await tx.auditLog.create({
            data: {
              actor: guard.actor,
              action: "batch.restored",
              newValue: { batchId: id, name: batch.name, slug: cleanSlug },
              metadata: { role: guard.role },
            },
          });
        });
        revalidateStorefront();
        return NextResponse.json({
          success: true,
          data: {
            message: `Batch "${batch.name}" and its orders restored (batch status set to Closed).`,
          },
        });
      }

      await prisma.$transaction(
        async (tx) => {
          const orders = await tx.order.findMany({
            where: { batchId: id },
            select: { id: true, status: true },
          });
          const orderIds = orders.map((o) => o.id);
          if (orderIds.length > 0) {
            for (const o of orders) {
              if (shouldReleaseCapacityOnPermanentDelete(o.status)) {
                await releaseOrderCapacity(tx, o.id);
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
              oldValue: { batchId: id, name: batch.name, slug: batch.slug },
              metadata: { role: guard.role, deletedOrders: orderIds.length },
            },
          });
        },
        { maxWait: 15_000, timeout: 30_000 }
      );
      revalidateStorefront();
      return NextResponse.json({
        success: true,
        data: { message: `Batch "${batch.name}" permanently deleted.` },
      });
    }

    // type === "product"
    const product = await prisma.product.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, archivedAt: true },
    });
    if (!product) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Product not found." } },
        { status: 404 }
      );
    }

    if (action === "restore") {
      if (!product.archivedAt) {
        return NextResponse.json({
          success: true,
          data: { message: `Product "${product.name}" is already in your Products tab.` },
        });
      }
      const cleanSlug = await uniqueProductSlug(stripArchivedSlugSuffix(product.slug), id);
      const linkedBatchId = await prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id },
          data: {
            archivedAt: null,
            active: true,
            slug: cleanSlug,
            preorderStatus: "CLOSED",
            preorderEnabled: true,
          },
        });
        const batchId = await ensureProductInOpenBatch(tx, id);
        await tx.auditLog.create({
          data: {
            actor: guard.actor,
            action: "product.restored",
            newValue: { productId: id, name: product.name, slug: cleanSlug, batchId },
            metadata: { role: guard.role },
          },
        });
        return batchId;
      });
      revalidateStorefront();
      return NextResponse.json({
        success: true,
        data: {
          message: linkedBatchId
            ? `Product "${product.name}" restored to Products and linked to your open batch (status set to Closed — edit it to Open when ready to take orders).`
            : `Product "${product.name}" restored to Products (status set to Closed — add it to a batch and set it to Open when ready).`,
        },
      });
    }

    await prisma.$transaction(
      async (tx) => {
        const variants = await tx.productVariant.findMany({
          where: { productId: id },
          select: { id: true },
        });
        const variantIds = variants.map((v) => v.id);
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
      },
      { maxWait: 15_000, timeout: 30_000 }
    );
    revalidateStorefront();
    return NextResponse.json({
      success: true,
      data: {
        message: `Product "${product.name}" permanently deleted. Historical order receipts were preserved.`,
      },
    });
  } catch (error) {
    console.error("[POST /api/admin/archive]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Archive action failed." } },
      { status: 500 }
    );
  }
}
