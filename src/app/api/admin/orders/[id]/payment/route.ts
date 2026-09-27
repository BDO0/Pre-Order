import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { paymentToggleSchema } from "@/lib/validation";
import { isPaymentChange, statusForPaid, toggleFor } from "@/lib/payment-state-machine";
import type { PaymentStatus } from "@prisma/client";

/**
 * The Paid / Unpaid toggle.
 *
 * This is the entire payment model. Customers pay over Instagram DM, outside the
 * app, so there is nothing to verify and nothing to upload — the only fact the
 * system can hold is whether the operator has confirmed the money arrived. The
 * old endpoint took an action (`VERIFY`/`REJECT`/`REFUND`) against a proof; a
 * boolean is what the business actually decides, and it makes the request
 * idempotent: re-sending `paid: true` is a no-op, not an error, because two clicks
 * on a laggy connection must not produce two audit entries claiming a change.
 *
 * Requires `payments.verify` rather than `orders.update`: recording money is a
 * different job from packing parcels, and the permission matrix separates them.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePermission("payments.verify", request);
    if (!guard.ok) return guard.response;

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid request body." } },
        { status: 400 }
      );
    }

    const parsed = paymentToggleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid payment update.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 }
      );
    }

    const { paid, note } = parsed.data;

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, reference: true, paymentStatus: true, total: true },
    });

    if (!order) {
      return NextResponse.json(
        { success: false, error: { code: "ORDER_NOT_FOUND", message: "Order not found." } },
        { status: 404 }
      );
    }

    const currentStatus = order.paymentStatus as PaymentStatus;
    const nextStatus = statusForPaid(paid);

    // Asking for the state the order is already in succeeds without touching the
    // audit trail — otherwise a double-tap fills the history with a change that
    // never happened.
    if (!isPaymentChange(currentStatus, paid)) {
      return NextResponse.json({
        success: true,
        data: { id: order.id, paymentStatus: currentStatus, changed: false },
      });
    }

    const toggle = toggleFor(paid);

    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id },
        data: { paymentStatus: nextStatus },
        select: { id: true, paymentStatus: true },
      });

      // The audit trail is what makes a money decision reviewable later, so the
      // actor, the role, both statuses, the amount and the note all go in.
      await tx.auditLog.create({
        data: {
          orderId: id,
          actor: guard.actor,
          action: `payment.${nextStatus.toLowerCase()}`,
          oldValue: { paymentStatus: currentStatus },
          newValue: { paymentStatus: nextStatus },
          metadata: {
            toggle: toggle.action,
            note: note ?? null,
            role: guard.role,
            orderReference: order.reference,
            amount: Number(order.total),
          },
        },
      });

      return updatedOrder;
    });

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        paymentStatus: updated.paymentStatus,
        changed: true,
      },
    });
  } catch (error) {
    console.error("[PATCH /api/admin/orders/[id]/payment]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}
