import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toPublicField } from "@/lib/order-answers";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * The checkout questions, for the checkout form.
 *
 * Public on purpose: this is what the storefront renders between "who are you?"
 * and "place pre-order", and requiring a session to see a form would mean nobody
 * could ever order. It is the only public endpoint in the app that reads from
 * `order_form_fields`, and it is careful about two things:
 *
 *  - **Nothing admin-only leaves.** Every row is passed through `toPublicField`,
 *    which drops `sensitive`, `active`, `deletedAt`, `sortOrder`, `createdAt`
 *    and `updatedAt`. A new admin column is therefore not published by default.
 *  - **Only live questions.** Soft-deleted (`deletedAt`) and switched-off
 *    (`active: false`) fields are excluded, so "hide this question" means it
 *    stops being asked rather than stops being answered.
 *
 * Order is the operator's (`sortOrder`), matched by the answer order stored on
 * the order itself. `createdAt` breaks ties so two questions created before
 * anybody reordered them still render in a stable order.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Cheap, public, and reads a table the storefront hits on every checkout
    // page load: generous, but not unlimited.
    const limited = enforceRateLimit(request, RATE_LIMITS.publicRead);
    if (limited) return limited;

    const fields = await prisma.orderFormField.findMany({
      where: { active: true, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        key: true,
        label: true,
        type: true,
        placeholder: true,
        helpText: true,
        required: true,
        options: true,
      },
    });

    return NextResponse.json({ success: true, data: fields.map(toPublicField) });
  } catch (error) {
    console.error("[GET /api/form-fields]", error);
    return NextResponse.json(
      {
        success: false,
        error: { code: "SERVER_ERROR", message: "Failed to load the checkout form." },
      },
      { status: 500 }
    );
  }
}
