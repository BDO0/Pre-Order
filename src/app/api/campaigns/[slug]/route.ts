import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const limited = enforceRateLimit(request, RATE_LIMITS.publicRead);
    if (limited) return limited;

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

    // ── Expiry is COMPUTED, never written ──────────────────────
    // This handler used to run `UPDATE campaigns SET status = 'CLOSED'` on any
    // GET whose campaign had ended. That made a read mutate the database: the
    // storefront page, a crawler, or a read-only smoke test could each close a
    // campaign, and the write fired even for requests that were about to be
    // refused. Expiry is a pure function of `endAt` and the clock, so it is now
    // derived on read and the operator's stored status is left untouched —
    // which also means extending a campaign's window reopens it correctly
    // instead of fighting a status the read path silently changed.
    const expired = Boolean(campaign.endAt && now > campaign.endAt);

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
        status: expired ? "CLOSED" : campaign.status,
        startAt: campaign.startAt,
        endAt: campaign.endAt,
        // An expired window hides the catalogue, not just the buttons: the
        // storefront reads `status` to render the closed state.
        products: expired
          ? []
          : browseProducts.map((p) => ({
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
        orderableCount: expired ? 0 : activeProducts.length,
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
