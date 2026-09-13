import { NextResponse } from "next/server";
import { getStoreSettings } from "@/lib/settings";

// Never cached: changing the delivery fee in the admin panel must be reflected
// on the very next checkout, not whenever a stale entry happens to expire.
export const dynamic = "force-dynamic";

/**
 * The storefront-facing subset of the settings table.
 *
 * Public on purpose — the cart and checkout have to show the same delivery fee
 * the server will charge, and a hardcoded 150 in the browser is exactly the
 * drift this endpoint exists to remove. Only display-safe values are exposed;
 * nothing that reveals internal configuration.
 */
export async function GET() {
  try {
    const settings = await getStoreSettings();

    return NextResponse.json({
      success: true,
      data: { shippingFee: settings.shippingFee },
    });
  } catch (error) {
    console.error("[GET /api/settings/public]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}
