import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Payment account details are customer-facing storefront configuration, so
    // they sit behind `settings.write` rather than any orders permission.
    const guard = await requirePermission("settings.write", request);
    if (!guard.ok) return guard.response;

    const { id } = await params;
    const body = await request.json();
    const { accountName, accountNumber, instructions, active } = body;

    const updated = await prisma.paymentMethod.update({
      where: { id },
      data: {
        accountName: accountName || null,
        accountNumber: accountNumber || null,
        instructions: instructions || null,
        active: active ?? true,
      },
    });

    await prisma.auditLog.create({
      data: {
        actor: guard.actor,
        action: "paymentMethod.updated",
        // Deliberately not logging the account number itself.
        newValue: { paymentMethodId: id, name: updated.name, active: updated.active },
        metadata: { role: guard.role },
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("[PATCH /api/admin/payment-methods/[id]]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
