import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { internalNotesSchema } from "@/lib/validation";

/**
 * Internal notes on an order.
 *
 * `Order.notes` is staff-only and is never returned by the public
 * /api/orders/[reference] lookup, so this is the one place it is written.
 * Kept as its own endpoint (rather than folded into the status PATCH) because
 * saving a note must not look like — or risk being mistaken for — a status
 * change, and each write gets its own audit-log action.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePermission("orders.update", request);
    if (!guard.ok) return guard.response;

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid request body." } },
        { status: 400 }
      );
    }

    const parsed = internalNotesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid note.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 }
      );
    }

    // Trim, then treat empty as a clear so staff can delete a note.
    const notes = parsed.data.notes.trim();
    const storedNotes = notes.length > 0 ? notes : null;

    const existing = await prisma.order.findUnique({
      where: { id },
      select: { id: true, notes: true },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: "ORDER_NOT_FOUND", message: "Order not found." } },
        { status: 404 }
      );
    }

    // A no-op save should not litter the audit trail.
    if (existing.notes === storedNotes) {
      return NextResponse.json({ success: true, data: { id, notes: storedNotes } });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id },
        data: { notes: storedNotes },
        select: { id: true, notes: true },
      });

      await tx.auditLog.create({
        data: {
          orderId: id,
          actor: guard.actor,
          action: "order.notes_updated",
          oldValue: { notes: existing.notes },
          newValue: { notes: storedNotes },
          metadata: { role: guard.role },
        },
      });

      return order;
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("[PUT /api/admin/orders/[id]/notes]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}
