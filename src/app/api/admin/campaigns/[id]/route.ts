import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });

    const { id } = await params;
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        products: { include: { product: true } },
        _count: { select: { orders: true } },
      },
    });

    if (!campaign) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Campaign not found." } }, { status: 404 });

    return NextResponse.json({ success: true, data: campaign });
  } catch (error) {
    console.error("[GET /api/admin/campaigns/[id]]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR" } }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });

    const { id } = await params;
    const body = await request.json();

    const { name, description, status, startAt, endAt, coverImage, productIds } = body;

    if (!name || name.trim().length < 2) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Campaign name is required." } }, { status: 400 });
    }

    // Update campaign core fields
    const updated = await prisma.campaign.update({
      where: { id },
      data: {
        name: name.trim(),
        description: description || null,
        status,
        startAt: startAt ? new Date(startAt) : null,
        endAt: endAt ? new Date(endAt) : null,
        coverImage: coverImage || null,
      },
    });

    // Sync product assignments if provided
    if (Array.isArray(productIds)) {
      // Remove all current products then re-add selected ones
      await prisma.campaignProduct.deleteMany({ where: { campaignId: id } });
      if (productIds.length > 0) {
        await prisma.campaignProduct.createMany({
          data: productIds.map((pid: string) => ({ campaignId: id, productId: pid })),
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        actor: session.user.email ?? "admin",
        action: "campaign.updated",
        newValue: { campaignId: id, status, name },
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("[PATCH /api/admin/campaigns/[id]]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });

    const { id } = await params;

    // Safety: can't delete a campaign with orders
    const orderCount = await prisma.order.count({ where: { campaignId: id } });
    if (orderCount > 0) {
      return NextResponse.json({
        success: false,
        error: { code: "CONFLICT", message: `Cannot delete: this campaign has ${orderCount} order(s). Archive it instead.` }
      }, { status: 409 });
    }

    await prisma.campaignProduct.deleteMany({ where: { campaignId: id } });
    await prisma.campaign.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/admin/campaigns/[id]]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
