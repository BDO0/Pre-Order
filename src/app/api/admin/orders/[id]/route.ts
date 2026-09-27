import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { hasPermission } from "@/lib/permissions";
import { orderStatusUpdateSchema } from "@/lib/validation";
import {
  assertValidTransition,
  getValidNextStatuses,
  releasesCapacity,
} from "@/lib/order-state-machine";
import { releaseOrderCapacity } from "@/lib/order-service";
import type { OrderStatus } from "@prisma/client";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePermission("orders.read", request);
    if (!guard.ok) return guard.response;
    const { id } = await params;
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        batch: { select: { id: true, name: true, slug: true, status: true, endAt: true } },
        customer: {
          select: {
            id: true,
            instagramHandle: true,
            createdAt: true,
            _count: { select: { orders: true } },
          },
        },
        items: {
          include: {
            variant: { include: { product: { select: { name: true, images: true } } } },
          },
        },
        statusHistory: { orderBy: { createdAt: "asc" } },
        auditLogs: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!order) {
      return NextResponse.json({ success: false, error: { code: "ORDER_NOT_FOUND", message: "Order not found." } }, { status: 404 });
    }
    const canUpdateOrder = hasPermission(guard.role, "orders.update");
    const canVerifyPayment = hasPermission(guard.role, "payments.verify");
    const canReadCustomer = hasPermission(guard.role, "customers.read");
    const customerSnapshot = order.customerSnapshot;
    const batch = order.batch
      ? { ...order.batch, etaAt: order.batch.endAt as Date | null }
      : null;
    return NextResponse.json({
      success: true,
      data: {
        ...order,
        batch,
        customerSnapshot,
        allowedTransitions: canUpdateOrder
          ? getValidNextStatuses(order.status as OrderStatus)
          : [],
        capabilities: {
          updateOrder: canUpdateOrder,
          verifyPayment: canVerifyPayment,
          readCustomer: canReadCustomer,
        },
        viewerRole: guard.role,
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/orders/[id]]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePermission("orders.update", request);
    if (!guard.ok) return guard.response;
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = orderStatusUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid status update." } }, { status: 400 });
    }
    const { status: newStatus, note } = parsed.data;
    const order = await prisma.order.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!order) return NextResponse.json({ success: false, error: { code: "ORDER_NOT_FOUND", message: "Order not found." } }, { status: 404 });
    assertValidTransition(order.status as OrderStatus, newStatus as OrderStatus);
    const capacityReleased =
      releasesCapacity(newStatus as OrderStatus) &&
      !releasesCapacity(order.status as OrderStatus);
    const applied = await prisma.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({
        where: { id, status: order.status as OrderStatus },
        data: { status: newStatus as OrderStatus },
      });
      if (claim.count !== 1) return false;
      if (capacityReleased) {
        await releaseOrderCapacity(tx, id);
      }
      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          fromStatus: order.status as OrderStatus,
          toStatus: newStatus as OrderStatus,
          changedBy: guard.actor,
          note: note ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          orderId: id,
          actor: guard.actor,
          action: "order.updated",
          oldValue: { status: order.status },
          newValue: { status: newStatus },
          metadata: { note, capacityReleased, role: guard.role },
        },
      });
      return true;
    });
    if (!applied) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "ORDER_CHANGED",
            message: "This order was changed by someone else. Reload it and try again.",
          },
        },
        { status: 409 }
      );
    }
    return NextResponse.json({
      success: true,
      data: {
        id,
        status: newStatus,
        allowedTransitions: getValidNextStatuses(newStatus as OrderStatus),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("ORDER_INVALID_TRANSITION")) {
      return NextResponse.json({ success: false, error: { code: "ORDER_INVALID_TRANSITION", message: "This status change is not allowed." } }, { status: 422 });
    }
    console.error("[PATCH /api/admin/orders/[id]]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
