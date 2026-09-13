import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { paymentActionSchema } from "@/lib/validation";
import {
  allowedPaymentActions,
  applyPaymentAction,
  PAYMENT_ACTIONS,
} from "@/lib/payment-state-machine";
import type { PaymentStatus } from "@prisma/client";

/**
 * Payment verification.
 *
 * Deliberately separate from the order status machine: an admin verifying that
 * money arrived is a different decision from moving the parcel along, and the
 * brief's audit example lists them as two events. So this endpoint changes
 * `paymentStatus` only, plus the audit trail — it never silently promotes the
 * order to CONFIRMED.
 *
 * The proof itself is not required to be present: some payment methods do not
 * ask for one (`requiresProof: false`), and a bank transfer can be confirmed
 * from a statement instead. Whether a proof exists is shown to the reviewer,
 * not enforced here.
 */
export async function POST(
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

    const parsed = paymentActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid payment action.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 }
      );
    }

    const { action, note } = parsed.data;

    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        reference: true,
        paymentStatus: true,
        total: true,
        _count: { select: { proofs: true } },
      },
    });

    if (!order) {
      return NextResponse.json(
        { success: false, error: { code: "ORDER_NOT_FOUND", message: "Order not found." } },
        { status: 404 }
      );
    }

    const currentStatus = order.paymentStatus as PaymentStatus;

    // Throws PAYMENT_INVALID_ACTION (mapped to 422 below) rather than letting an
    // illegal move through — e.g. refunding an order that was never paid.
    let nextStatus: PaymentStatus;
    try {
      nextStatus = applyPaymentAction(currentStatus, action);
    } catch (error) {
      if (error instanceof Error && error.message.includes("PAYMENT_INVALID_ACTION")) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "PAYMENT_INVALID_ACTION",
              message: `A payment in ${currentStatus} cannot be ${
                PAYMENT_ACTIONS[action].label.toLowerCase()
              }d.`,
            },
          },
          { status: 422 }
        );
      }
      throw error;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id },
        data: { paymentStatus: nextStatus },
        select: { id: true, paymentStatus: true },
      });

      // The audit trail is what makes a money decision reviewable later, so the
      // action, the actor, the role, both statuses and the note all go in.
      await tx.auditLog.create({
        data: {
          orderId: id,
          actor: guard.actor,
          action: `payment.${action.toLowerCase()}`,
          oldValue: { paymentStatus: currentStatus },
          newValue: { paymentStatus: nextStatus },
          metadata: {
            note: note ?? null,
            role: guard.role,
            orderReference: order.reference,
            amount: order.total,
            proofCount: order._count.proofs,
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
        allowedPaymentActions: allowedPaymentActions(
          updated.paymentStatus as PaymentStatus
        ),
      },
    });
  } catch (error) {
    console.error("[POST /api/admin/orders/[id]/payment]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}
