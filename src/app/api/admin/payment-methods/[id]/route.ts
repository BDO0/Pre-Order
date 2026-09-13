import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });

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

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("[PATCH /api/admin/payment-methods/[id]]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
