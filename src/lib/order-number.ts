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

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const REFERENCE_SUFFIX_LENGTH = 4;

function randomReferenceSuffix(length: number): string {
  const bytes = randomBytes(length);
  let suffix = "";
  for (let index = 0; index < length; index += 1) {
    suffix += REFERENCE_ALPHABET.charAt(bytes[index] % REFERENCE_ALPHABET.length);
  }
  return suffix;
}
