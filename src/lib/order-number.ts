import { prisma } from "@/lib/db";
import { format } from "date-fns";

/**
 * Allocates the next order reference number.
 * Format: PO-YYYYMMDD-NNNN (padded, per-day sequence)
 * Example: PO-20260826-0017
 *
 * The per-day counter lives in `order_counters` and is advanced by a single
 * atomic upsert, so two simultaneous checkouts can never be handed the same
 * number. It used to be derived from MAX(reference) + 1, which concurrent
 * transactions read at the same instant and then both tried to insert.
 *
 * Allocation is deliberately its own statement rather than part of the order
 * transaction: the counter row lock is then held for microseconds instead of
 * for the whole checkout. A checkout that fails after this point therefore
 * leaves a gap in the numbering, which is fine — a gap is strictly better than
 * two orders sharing a reference.
 */
export async function generateOrderReference(): Promise<string> {
  const now = new Date();
  const prefix = `PO-${format(now, "yyyyMMdd")}-`;
  const day = format(now, "yyyy-MM-dd");

  const rows = await prisma.$queryRaw<Array<{ last_value: number }>>`
    INSERT INTO order_counters (day, last_value, updated_at)
    VALUES (${day}::date, 1, CURRENT_TIMESTAMP)
    ON CONFLICT (day) DO UPDATE
      SET last_value = order_counters.last_value + 1,
          updated_at = CURRENT_TIMESTAMP
    RETURNING last_value
  `;

  const nextSequence = rows[0]?.last_value ?? 1;

  return `${prefix}${String(nextSequence).padStart(4, "0")}`;
}
