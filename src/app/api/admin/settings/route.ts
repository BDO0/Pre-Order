import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/api-guard";
import { settingsUpdateSchema } from "@/lib/validation";
import { getStoreSettings, updateStoreSettings } from "@/lib/settings";

/**
 * Store settings (shipping fee, and whatever else gets a key next).
 *
 * Both verbs sit behind `settings.write`, so a VIEWER or PRODUCT_MANAGER cannot
 * even read them here — the storefront-facing subset is published separately by
 * /api/settings/public.
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requirePermission("settings.write", request);
    if (!guard.ok) return guard.response;

    return NextResponse.json({ success: true, data: await getStoreSettings() });
  } catch (error) {
    console.error("[GET /api/admin/settings]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const guard = await requirePermission("settings.write", request);
    if (!guard.ok) return guard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid request body." } },
        { status: 400 }
      );
    }

    const parsed = settingsUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid settings.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 }
      );
    }

    const settings = await updateStoreSettings(parsed.data, guard.actor);

    return NextResponse.json({ success: true, data: settings });
  } catch (error) {
    console.error("[PATCH /api/admin/settings]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}
