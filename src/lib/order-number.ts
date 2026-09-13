import { prisma } from "@/lib/db";
import { format } from "date-fns";

/**
 * Generates a human-friendly order reference number.
 * Format: PO-YYYYMMDD-NNNN (padded, per-day sequence)
 * Example: PO-20260826-0017
 *
 * NOTE: this is deliberately optimistic — two simultaneous checkouts can
 * compute the same sequence. `orders.reference` is UNIQUE and is the real
 * arbiter; callers must retry on a unique violation (see `createOrder`).
 *
 * For volumes above a few thousand orders per day, replace this with a
 * dedicated counter row or Postgres sequence.
 */
export async function generateOrderReference(): Promise<string> {
  const prefix = `PO-${format(new Date(), "yyyyMMdd")}-`;

  // Highest sequence issued today. The reference is fixed-width, so a lexical
  // DESC sort matches numeric DESC. Using MAX instead of COUNT also keeps the
  // numbering monotonic when an order is deleted (COUNT would hand out a
  // number that has already been used).
  const lastOrderToday = await prisma.order.findFirst({
    where: { reference: { startsWith: prefix } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });

  const lastSequence = lastOrderToday
    ? Number.parseInt(lastOrderToday.reference.slice(prefix.length), 10)
    : 0;

  const nextSequence = Number.isNaN(lastSequence) ? 1 : lastSequence + 1;

  return `${prefix}${String(nextSequence).padStart(4, "0")}`;
}
