import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

export const ORDER_REFERENCE_TIMEZONE = "Asia/Manila";

export function formatManilaDateParts(now = new Date()): {
  compact: string;
  isoDay: string;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ORDER_REFERENCE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return {
    compact: `${year}${month}${day}`,
    isoDay: `${year}-${month}-${day}`,
  };
}

export async function generateOrderReference(now = new Date()): Promise<string> {
  const { compact, isoDay } = formatManilaDateParts(now);
  const prefix = `PO-${compact}-`;
  const rows = await prisma.$queryRaw<Array<{ last_value: number }>>`
    INSERT INTO order_counters (day, last_value, updated_at)
    VALUES (${isoDay}::date, 1, CURRENT_TIMESTAMP)
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
