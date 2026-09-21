import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { isAccessTokenShaped } from "@/lib/order-token";
import { normaliseInstagramHandle } from "@/lib/instagram";
import type { Prisma } from "@prisma/client";

/**
 * Public order lookup — the "I lost my link" route.
 *
 * Two doors, one response shape:
 *
 *   1. `?token=<accessToken>` — the capability URL the customer was handed on
 *      the confirmation screen. Holding it is proof enough: it is 192 bits of
 *      CSPRNG output and it identifies exactly one order.
 *
 *   2. `?ref=<reference>&handle=<instagram>` — the fallback. Both halves are
 *      required: an order reference is `PO-YYYYMMDD-NNNN`, guessable by design,
 *      so it can never be sufficient on its own. The handle is the second
 *      factor, and it is the same key the rest of the app treats as the
 *      customer's identity.
 *
 * A failure on either door returns the identical message, so this endpoint
 * cannot be used to answer "does order PO-20260917-0007 exist?".
 *
 * GET, not POST, because the whole point of the feature is a link a customer
 * can paste into a DM and open. Nothing here mutates.
 */

export const dynamic = "force-dynamic";

/**
 * Exactly the columns the status page renders, and no more.
 *
 * An explicit select rather than an `include`, so a column added to `orders`
 * later is not silently published to an unauthenticated endpoint.
 */
const ORDER_SELECT = {
  reference: true,
  status: true,
  paymentStatus: true,
  createdAt: true,
  subtotal: true,
  total: true,
  customerSnapshot: true,
  batch: { select: { name: true } },
  items: {
    select: {
      quantity: true,
      unitPriceAtPurchase: true,
      productNameSnapshot: true,
      variantSnapshot: true,
    },
  },
  // Status and date only. An operator's note ("called her, address confirmed")
  // is internal shorthand written for the next person on the queue, and it is
  // not something the customer agreed to have published.
  statusHistory: {
    select: { toStatus: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.OrderSelect;

type PublicOrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

function snapshotField(snapshot: unknown, key: string): string | null {
  if (typeof snapshot !== "object" || snapshot === null) return null;
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** `{ color, size }`, written the way a customer reads a variant. */
function snapshotVariantLabel(snapshot: unknown): string {
  if (typeof snapshot !== "object" || snapshot === null) return "";
  const variant = snapshot as { color?: unknown; size?: unknown };
  return [variant.color, variant.size]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(" / ");
}

function toPublicOrder(order: PublicOrderRow) {
  return {
    reference: order.reference,
    status: order.status,
    paymentStatus: order.paymentStatus,
    placedAt: order.createdAt.toISOString(),
    dropName: order.batch?.name ?? null,
    customerName: snapshotField(order.customerSnapshot, "fullName"),
    items: order.items.map((item) => ({
      productName: item.productNameSnapshot,
      variant: snapshotVariantLabel(item.variantSnapshot),
      quantity: item.quantity,
      unitPrice: Number(item.unitPriceAtPurchase),
      lineTotal: Number(item.unitPriceAtPurchase) * item.quantity,
    })),
    subtotal: Number(order.subtotal),
    total: Number(order.total),
    timeline: order.statusHistory.map((entry) => ({
      status: entry.toStatus,
      at: entry.createdAt.toISOString(),
    })),
  };
}

/** Deliberately one message for "no such order" and "wrong handle". */
function notFound() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "ORDER_NOT_FOUND",
        message:
          "We could not find an order with those details. Check the order number, and the Instagram username the order was placed with.",
      },
    },
    // `no-store` on every branch: these responses carry a name, a handle and an
    // order, and none of that belongs in a shared cache.
    { status: 404, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(request, RATE_LIMITS.orderLookup);
    if (limited) return limited;

    const params = request.nextUrl.searchParams;
    const token = params.get("token");
    const reference = params.get("ref")?.trim();
    const handle = normaliseInstagramHandle(params.get("handle"));

    let order: PublicOrderRow | null = null;

    if (isAccessTokenShaped(token)) {
      order = await prisma.order.findUnique({
        where: { accessToken: token },
        select: ORDER_SELECT,
      });
    } else if (reference && handle) {
      const found = await prisma.order.findUnique({
        where: { reference: reference.toUpperCase() },
        select: ORDER_SELECT,
      });

      // Compared against the row just fetched, so the handle check costs no
      // extra round trip. Both sides are normalised, so "@JuanDC" typed into
      // the form still matches the "juandc" the database stores.
      const placedWith = snapshotField(
        found?.customerSnapshot ?? null,
        "instagramHandle"
      );
      order =
        found && placedWith && placedWith.toLowerCase() === handle ? found : null;
    } else {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message:
              "Please provide your order number and Instagram username, or open the private link from your confirmation screen.",
          },
        },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!order) return notFound();

    return NextResponse.json(
      { success: true, data: toPublicOrder(order) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[GET /api/orders/lookup]", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SERVER_ERROR",
          message: "We could not look that up just now. Please try again.",
        },
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
