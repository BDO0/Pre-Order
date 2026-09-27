import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { hasPermission } from "@/lib/permissions";
import { assertValidTransition, getValidNextStatuses } from "@/lib/order-state-machine";
import type { OrderStatus, PaymentStatus } from "@prisma/client";

/**
 * 1-Click Atomic Confirm & Pay.
 *
 * Designed specifically for non-technical admins handling pre-orders settled
 * over Instagram DM. When a customer sends a payment receipt or confirmation,
 * the admin shouldn't have to navigate multiple cards and make two separate
 * status and payment clicks. This endpoint sets status = CONFIRMED and
 * paymentStatus = PAID in a single atomic transaction.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePermission("orders.update", request);
    if (!guard.ok) return guard.response;

    if (!hasPermission(guard.role, "payments.verify")) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Your role is not allowed to verify payments.",
          },
        },
        { status: 403 }
      );
    }

    const { id } = await params;

    let body: { note?: string } = {};
    try {
      body = (await request.json()) as { note?: string };
    } catch {
    }

    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        reference: true,
        status: true,
        paymentStatus: true,
        total: true,
      },
    });

    if (!order) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "ORDER_NOT_FOUND", message: "Order not found." },
        },
        { status: 404 }
      );
    }

    const currentStatus = order.status as OrderStatus;
    const currentPayment = order.paymentStatus as PaymentStatus;

    if (currentStatus === "CONFIRMED" && currentPayment === "PAID") {
      return NextResponse.json({
        success: true,
        data: {
          id: order.id,
          status: "CONFIRMED",
          paymentStatus: "PAID",
          changed: false,
          allowedTransitions: getValidNextStatuses("CONFIRMED"),
        },
      });
    }

    if (currentStatus !== "CONFIRMED") {
      assertValidTransition(currentStatus, "CONFIRMED");
    }

    const noteText = body.note?.trim() || "Confirmed and payment recorded via Instagram DM";

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: {
          status: "CONFIRMED",
          paymentStatus: "PAID",
        },
      });

      if (currentStatus !== "CONFIRMED") {
        await tx.orderStatusHistory.create({
          data: {
            orderId: id,
            fromStatus: currentStatus,
            toStatus: "CONFIRMED",
            changedBy: guard.actor,
            note: noteText,
          },
        });
      }

      if (currentPayment !== "PAID") {
        await tx.auditLog.create({
          data: {
            orderId: id,
            actor: guard.actor,
            action: "payment.paid",
            oldValue: { paymentStatus: currentPayment },
            newValue: { paymentStatus: "PAID" },
            metadata: {
              toggle: "MARK_PAID",
              note: noteText,
              role: guard.role,
              orderReference: order.reference,
              amount: Number(order.total),
            },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          orderId: id,
          actor: guard.actor,
          action: "order.confirmed_and_paid",
          oldValue: { status: currentStatus, paymentStatus: currentPayment },
          newValue: { status: "CONFIRMED", paymentStatus: "PAID" },
          metadata: { note: noteText, role: guard.role },
        },
      });
    });

    return NextResponse.json({
      success: true,
      data: {
        id: order.id,
        status: "CONFIRMED",
        paymentStatus: "PAID",
        changed: true,
        allowedTransitions: getValidNextStatuses("CONFIRMED"),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("ORDER_INVALID_TRANSITION")) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "ORDER_INVALID_TRANSITION",
            message: "Cannot confirm this order from its current status.",
          },
        },
        { status: 422 }
      );
    }
    console.error("[PATCH /api/admin/orders/[id]/confirm-and-pay]", error);
    return NextResponse.json(
      {
        success: false,
        error: { code: "SERVER_ERROR", message: "Something went wrong." },
      },
      { status: 500 }
    );
  }
}
