import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { SHOP_INSTAGRAM_HANDLE, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/**
 * The Open Graph card for a batch.
 *
 * Built server-side rather than cropped from the cover image, for two reasons
 * that matter when a drop is being shared around Instagram: a card always looks
 * deliberate regardless of what the operator uploaded, and it can carry the
 * things that make a first-time visitor trust the link — the batch name, how
 * many pieces are still available, and the account that runs the shop.
 *
 * Rendered on demand and cached for five minutes: a card is fetched by
 * crawlers, not by people, and regenerating it per request would mean a database
 * query per unfurl.
 */
export const runtime = "nodejs";
// Generated on demand, never at build time: a build must not depend on the
// database being reachable. Caching is expressed in the response headers.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  let title = SITE_NAME;
  let subtitle = SITE_TAGLINE;
  let remaining: number | null = null;

  try {
    const batch = await prisma.batch.findUnique({
      where: { slug },
      select: {
        name: true,
        description: true,
        endAt: true,
        products: {
          select: {
            product: {
              select: { preorderLimit: true, preorderReserved: true, active: true },
            },
          },
        },
      },
    });

    if (batch) {
      title = batch.name;
      subtitle = batch.description?.slice(0, 120) ?? SITE_TAGLINE;

      // "12 left" is the single most useful thing a card can say, and it is
      // derived from the same reserved/limit columns the storefront reads.
      const limited = batch.products
        .map((entry) => entry.product)
        .filter((product) => product.active && product.preorderLimit !== null);

      if (limited.length > 0) {
        remaining = limited.reduce(
          (sum, product) =>
            sum + Math.max((product.preorderLimit ?? 0) - product.preorderReserved, 0),
          0
        );
      }
    }
  } catch (error) {
    // A card is decoration: a database blip must still produce an image rather
    // than a broken unfurl.
    console.error("[GET /api/og/batch/[slug]]", error);
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px",
          background: "linear-gradient(135deg, #111827 0%, #1f2937 60%, #374151 100%)",
          color: "#f9fafb",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 2 }}>{SITE_NAME}</div>
          <div style={{ fontSize: 26, color: "#9ca3af" }}>{`@${SHOP_INSTAGRAM_HANDLE}`}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.1 }}>{title}</div>
          <div style={{ fontSize: 30, color: "#d1d5db", marginTop: 24 }}>{subtitle}</div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ fontSize: 30, color: "#9ca3af" }}>
            {remaining !== null ? `${remaining} pieces still available` : "Open for pre-order"}
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              padding: "12px 28px",
              borderRadius: 999,
              background: "#f9fafb",
              color: "#111827",
            }}
          >
            Reserve yours
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        // Cached for crawlers, but never so long that a closed drop keeps
        // advertising stock it no longer has.
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    }
  );
}
