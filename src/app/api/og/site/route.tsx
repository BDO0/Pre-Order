import { ImageResponse } from "next/og";
import {
  SHOP_INSTAGRAM_HANDLE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
} from "@/lib/site";

/**
 * The default social card, used by the home page and by every page that has no
 * artwork of its own.
 *
 * Exists so that a shared link is never a bare grey rectangle: the card states
 * what the shop does and which Instagram account runs it, which is exactly the
 * information someone needs before they tap a link from a stranger's story.
 */
export const runtime = "nodejs";
// Generated on demand, never at build time: a build must not depend on the
// database being reachable, and an image is only ever needed by a crawler
// unfurling a link. Caching is expressed in the response headers instead.
export const dynamic = "force-dynamic";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "72px",
          background: "linear-gradient(135deg, #111827 0%, #1f2937 100%)",
          color: "#f9fafb",
          fontFamily: "sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: 2 }}>{SITE_NAME}</div>
        <div style={{ fontSize: 38, color: "#d1d5db", marginTop: 20 }}>{SITE_TAGLINE}</div>
        <div style={{ fontSize: 28, color: "#9ca3af", marginTop: 32, maxWidth: 900 }}>
          {SITE_DESCRIPTION}
        </div>
        <div style={{ fontSize: 30, marginTop: 40, color: "#f9fafb", fontWeight: 700 }}>
          {`@${SHOP_INSTAGRAM_HANDLE}`}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" },
    }
  );
}
