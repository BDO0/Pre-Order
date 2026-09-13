import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  try {
    const { reference } = await params;
    const { searchParams } = new URL(request.url);
    const mobileNumber = searchParams.get("mobile");

    if (!mobileNumber) {
      return NextResponse.json(
        { success: false, error: { code: "VERIFICATION_REQUIRED", message: "Mobile number is required to look up an order." } },
        { status: 400 }
      );
    }

    const order = await prisma.order.findUnique({
      where: { reference },
      include: {
        items: {
          select: {
            id: true,
            quantity: true,
            unitPriceAtPurchase: true,
            productNameSnapshot: true,
            variantSnapshot: true,
          },
        },
        statusHistory: {
          orderBy: { createdAt: "asc" },
          select: { toStatus: true, note: true, createdAt: true },
        },
      },
    });

    if (!order) {
      return NextResponse.json(
        { success: false, error: { code: "ORDER_NOT_FOUND", message: "Order not found. Please check your order number." } },
        { status: 404 }
      );
    }

    // Verify mobile number matches — second factor
    const snapshot = order.customerSnapshot as { mobileNumber?: string };
    if (snapshot.mobileNumber !== mobileNumber) {
      return NextResponse.json(
        { success: false, error: { code: "ORDER_NOT_FOUND", message: "Order not found. Please check your order number." } },
        { status: 404 }
      );
    }

    // Return limited public data only — do NOT expose address, admin notes, etc.
    return NextResponse.json({
      success: true,
      data: {
        reference: order.reference,
        status: order.status,
        paymentStatus: order.paymentStatus,
        total: order.total,
        createdAt: order.createdAt,
        items: order.items.map((item) => ({
          productName: item.productNameSnapshot,
          variant: item.variantSnapshot,
          quantity: item.quantity,
          unitPrice: item.unitPriceAtPurchase,
        })),
        statusHistory: order.statusHistory,
      },
    });
  } catch (error) {
    console.error("[GET /api/orders/[reference]]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}
