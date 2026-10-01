import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { format } from "date-fns";
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
  const seqPart = String(nextSequence).padStart(4, "0");
  
  return `${prefix}${seqPart}-${randomReferenceSuffix(REFERENCE_SUFFIX_LENGTH)}`;
}

// I, O, 0 and 1 are omitted: these references get read aloud and retyped in
// Instagram DM, and those four are the pairs people transcribe wrongly.
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const REFERENCE_SUFFIX_LENGTH = 4;

/**
 * Appends unpredictable characters to the sequential reference.
 *
 * The sequence on its own is guessable (`PO-20260929-0001`) and
 * `/api/orders/lookup` accepts a reference plus an Instagram handle, so anyone
 * who knows a customer handle could otherwise walk that day orders. This
 * suffix is what makes the walk impractical.
 *
 * `randomBytes` rather than `Math.random()`: the latter is not a CSPRNG and is
 * predictable from a few observed values, which matters because a customer
 * sees their own reference. `node:crypto` already backs access tokens and
 * upload filenames.
 *
 * The alphabet is 32 characters and 256 % 32 === 0, so the modulo is exactly
 * uniform and needs no rejection sampling.
 */
function randomReferenceSuffix(length: number): string {
  const bytes = randomBytes(length);
  let suffix = "";
  for (let index = 0; index < length; index += 1) {
    suffix += REFERENCE_ALPHABET.charAt(bytes[index] % REFERENCE_ALPHABET.length);
  }
  return suffix;
}
