import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const now = new Date();

    const campaign = await prisma.campaign.findUnique({
      where: { slug },
      include: {
        products: {
          include: {
            product: {
              include: {
                variants: {
                  where: { active: true },
                  orderBy: [{ color: "asc" }, { size: "asc" }],
                },
              },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!campaign) {
      return NextResponse.json(
        { success: false, error: { code: "CAMPAIGN_NOT_FOUND", message: "Campaign not found." } },
        { status: 404 }
      );
    }

    // Check time-based expiry
    if (campaign.endAt && now > campaign.endAt) {
      // Auto-close (mark as CLOSED) silently
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "CLOSED" },
      });
      return NextResponse.json({
        success: true,
        data: { ...campaign, status: "CLOSED", products: [] },
      });
    }

    // Filter to only preorder-enabled, active products
    const activeProducts = campaign.products
      .map((cp) => cp.product)
      .filter(
        (p) => p.active && p.preorderEnabled && p.preorderStatus === "OPEN"
      );

    // Also include COMING_SOON and SOLD_OUT for browsing (but not ordering)
    const browseProducts = campaign.products
      .map((cp) => cp.product)
      .filter(
        (p) =>
          p.active &&
          p.preorderEnabled &&
          ["OPEN", "COMING_SOON", "SOLD_OUT"].includes(p.preorderStatus)
      );

    return NextResponse.json({
      success: true,
      data: {
        id: campaign.id,
        name: campaign.name,
        slug: campaign.slug,
        description: campaign.description,
        coverImage: campaign.coverImage,
        status: campaign.status,
        startAt: campaign.startAt,
        endAt: campaign.endAt,
        products: browseProducts.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          description: p.description,
          price: p.price,
          currency: p.currency,
          images: p.images,
          category: p.category,
          preorderStatus: p.preorderStatus,
          preorderLimit: p.preorderLimit,
          preorderReserved: p.preorderReserved,
          preorderRemaining: p.preorderLimit
            ? p.preorderLimit - p.preorderReserved
            : null,
          variants: p.variants.map((v) => ({
            id: v.id,
            size: v.size,
            color: v.color,
            sku: v.sku,
            priceOverride: v.priceOverride,
            capacity: v.capacity,
            remainingCapacity: v.remainingCapacity,
            active: v.active,
          })),
        })),
        orderableCount: activeProducts.length,
      },
    });
  } catch (error) {
    console.error("[GET /api/campaigns/[slug]]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}
