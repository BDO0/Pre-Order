import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { orderStatusUpdateSchema } from "@/lib/validation";
import {
  assertValidTransition,
  releasesCapacity,
} from "@/lib/order-state-machine";
import { releaseOrderCapacity } from "@/lib/order-service";
import type { OrderStatus } from "@prisma/client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized." } }, { status: 401 });

    const { id } = await params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        campaign: { select: { id: true, name: true, slug: true } },
        customer: true,
        paymentMethod: true,
        items: {
          include: {
            variant: { include: { product: { select: { name: true, images: true } } } },
          },
        },
        proofs: true,
        statusHistory: { orderBy: { createdAt: "asc" } },
        auditLogs: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!order) {
      return NextResponse.json({ success: false, error: { code: "ORDER_NOT_FOUND", message: "Order not found." } }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: order });
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
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized." } }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const parsed = orderStatusUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid status update." } }, { status: 400 });
    }

    const { status: newStatus, note } = parsed.data;

    const order = await prisma.order.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!order) return NextResponse.json({ success: false, error: { code: "ORDER_NOT_FOUND", message: "Order not found." } }, { status: 404 });

    // Enforce state machine
    assertValidTransition(order.status as OrderStatus, newStatus as OrderStatus);

    // Voiding an order must return its reserved stock, otherwise the capacity
    // is lost forever and the storefront keeps showing the item as sold out.
    // Computed before the write and applied inside the same transaction, so the
    // status change and the capacity change can never drift apart.
    const capacityReleased =
      releasesCapacity(newStatus as OrderStatus) &&
      !releasesCapacity(order.status as OrderStatus);

    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id },
        data: { status: newStatus as OrderStatus },
      });

      if (capacityReleased) {
        await releaseOrderCapacity(tx, id);
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          fromStatus: order.status as OrderStatus,
          toStatus: newStatus as OrderStatus,
          changedBy: session.user?.email ?? "admin",
          note: note ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          orderId: id,
          actor: session.user?.email ?? "admin",
          action: "order.updated",
          oldValue: { status: order.status },
          newValue: { status: newStatus },
          metadata: { note, capacityReleased },
        },
      });

      return updatedOrder;
    });

    return NextResponse.json({ success: true, data: { id: updated.id, status: updated.status } });
  } catch (error) {
    if (error instanceof Error && error.message.includes("ORDER_INVALID_TRANSITION")) {
      return NextResponse.json({ success: false, error: { code: "ORDER_INVALID_TRANSITION", message: "This status change is not allowed." } }, { status: 422 });
    }
    console.error("[PATCH /api/admin/orders/[id]]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
