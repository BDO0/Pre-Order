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
import { allowedPaymentActions } from "@/lib/payment-state-machine";
import { releaseOrderCapacity } from "@/lib/order-service";
import type { OrderStatus, PaymentStatus } from "@prisma/client";
import {
  CUSTOMER_PII_FIELDS,
  DELIVERY_PII_FIELDS,
  redactSnapshot,
} from "@/lib/redaction";

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

    // What this viewer may do, decided server-side and shipped with the payload.
    // The UI renders exactly these flags, so it cannot offer an action the API
    // would refuse — and a role without `customers.read` (e.g. PRODUCT_MANAGER)
    // never receives the customer's contact details in the first place, which is
    // the part of a permission that actually protects anyone.
    const canUpdateOrder = hasPermission(guard.role, "orders.update");
    const canVerifyPayment = hasPermission(guard.role, "payments.verify");
    const canReadCustomer = hasPermission(guard.role, "customers.read");

    const customerSnapshot = canReadCustomer
      ? order.customerSnapshot
      : redactSnapshot(
          order.customerSnapshot as Record<string, unknown>,
          CUSTOMER_PII_FIELDS
        );

    const deliverySnapshot = canReadCustomer
      ? order.deliverySnapshot
      : redactSnapshot(
          order.deliverySnapshot as Record<string, unknown>,
          DELIVERY_PII_FIELDS
        );

    return NextResponse.json({
      success: true,
      data: {
        ...order,
        customerSnapshot,
        deliverySnapshot,
        // Empty arrays for a viewer who may not act, so no button is rendered.
        allowedTransitions: canUpdateOrder
          ? getValidNextStatuses(order.status as OrderStatus)
          : [],
        allowedPaymentActions: canVerifyPayment
          ? allowedPaymentActions(order.paymentStatus as PaymentStatus)
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

      return updatedOrder;
    });

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        status: updated.status,
        // Refreshed here so the caller can re-render without a second round trip.
        allowedTransitions: getValidNextStatuses(updated.status as OrderStatus),
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
