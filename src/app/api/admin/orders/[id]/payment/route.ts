import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { paymentToggleSchema } from "@/lib/validation";
import { isPaymentChange, statusForPaid, toggleFor } from "@/lib/payment-state-machine";
import type { PaymentStatus } from "@prisma/client";
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
    if (!isPaymentChange(currentStatus, paid)) {
      return NextResponse.json({
        success: true,
        data: { id: order.id, paymentStatus: currentStatus, changed: false },
      });
    }
    const toggle = toggleFor(paid);
    const applied = await prisma.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({
        where: { id, paymentStatus: currentStatus },
        data: { paymentStatus: nextStatus },
      });
      if (claim.count !== 1) return false;
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
        id: order.id,
        paymentStatus: nextStatus,
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
