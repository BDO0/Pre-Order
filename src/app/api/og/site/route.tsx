import { ImageResponse } from "next/og";
import {
  SHOP_INSTAGRAM_HANDLE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
} from "@/lib/site";
import { TUDUNGPEOPLE_EMBLEM_PATH } from "@/components/BrandLogo";

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
          background: "radial-gradient(circle at 50% 30%, #4a0c1c 0%, #20030a 60%, #0d0104 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
          textAlign: "center",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
          <svg
            width="130"
            height="97"
            viewBox="384 246 1220 910"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d={TUDUNGPEOPLE_EMBLEM_PATH}
              fill="#ffffff"
              fillRule="evenodd"
            />
          </svg>
        </div>

        <div style={{ fontSize: 68, fontWeight: 700, letterSpacing: 8, textTransform: "uppercase" }}>
          TUDUNGPEOPLE
        </div>
        <div style={{ fontSize: 24, fontWeight: 500, letterSpacing: 14, textTransform: "uppercase", color: "rgba(255, 220, 230, 0.8)", marginTop: 8, paddingLeft: 14 }}>
          PHILIPPINES
        </div>

        <div style={{ fontSize: 30, color: "#fbcfe8", marginTop: 28, maxWidth: 900 }}>
          {SITE_DESCRIPTION}
        </div>
        <div style={{ fontSize: 26, marginTop: 36, color: "#ffffff", fontWeight: 600, padding: "10px 28px", borderRadius: 999, background: "rgba(255, 255, 255, 0.12)", border: "1px solid rgba(255, 255, 255, 0.2)" }}>
          {`DM: @${SHOP_INSTAGRAM_HANDLE}`}
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
