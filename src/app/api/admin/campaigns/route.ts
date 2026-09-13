import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { campaignSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    const guard = await requirePermission("campaigns.read", request);
    if (!guard.ok) return guard.response;

    const campaigns = await prisma.campaign.findMany({
      include: {
        products: { include: { product: { select: { id: true, name: true } } } },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, data: campaigns });
  } catch (error) {
    console.error("[GET /api/admin/campaigns]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePermission("campaigns.write", request);
    if (!guard.ok) return guard.response;

    const body = await request.json();
    const parsed = campaignSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid campaign data.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
    }

    const campaign = await prisma.campaign.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description,
        status: parsed.data.status,
        startAt: parsed.data.startAt ? new Date(parsed.data.startAt) : null,
        endAt: parsed.data.endAt ? new Date(parsed.data.endAt) : null,
        coverImage: body.coverImage || null,
        products: {
          create: Array.isArray(body.productIds) 
            ? body.productIds.map((id: string) => ({ productId: id }))
            : [],
        }
      },
    });

    await prisma.auditLog.create({
      data: {
        actor: guard.actor,
        action: "campaign.created",
        newValue: { campaignId: campaign.id, name: campaign.name },
      },
    });

    return NextResponse.json({ success: true, data: campaign }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/campaigns]", error);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } }, { status: 500 });
  }
}
