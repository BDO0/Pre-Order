import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  DEFAULT_STORE_SETTINGS,
  SETTING_KEYS,
  normaliseShippingFee,
  type StoreSettings,
} from "@/lib/pricing";

/**
 * Server-side access to the `settings` table.
 *
 * Replaces the hardcoded `150` that used to live in three files. Every read
 * degrades to `DEFAULT_STORE_SETTINGS` instead of throwing: a missing row, an
 * unapplied migration, or a database blip must never prevent a customer from
 * checking out with a total.
 */

/** Reads every setting this app knows about in one round trip. */
export async function getStoreSettings(): Promise<StoreSettings> {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: Object.values(SETTING_KEYS) } },
      select: { key: true, value: true },
    });

    const byKey = new Map(rows.map((row) => [row.key, row.value]));

    return {
      shippingFee: normaliseShippingFee(
        byKey.get(SETTING_KEYS.shippingFee) ??
          DEFAULT_STORE_SETTINGS.shippingFee
      ),
    };
  } catch (error) {
    console.error(
      "[settings] falling back to defaults — could not read the settings table",
      error
    );
    return DEFAULT_STORE_SETTINGS;
  }
}

/** Convenience for the order service, which only needs the delivery fee. */
export async function getShippingFee(): Promise<number> {
  const settings = await getStoreSettings();
  return settings.shippingFee;
}

/**
 * Writes a settings patch and records who did it.
 *
 * Upsert rather than update so the very first save on a fresh database (no
 * seeded rows) works, and so a deploy that adds a key does not need a migration
 * per key.
 */
export async function updateStoreSettings(
  patch: Partial<StoreSettings>,
  actor: string
): Promise<StoreSettings> {
  const rows: { key: string; value: Prisma.InputJsonValue }[] = [];

  if (patch.shippingFee !== undefined) {
    rows.push({
      key: SETTING_KEYS.shippingFee,
      value: normaliseShippingFee(patch.shippingFee),
    });
  }

  if (rows.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.setting.upsert({
          where: { key: row.key },
          update: { value: row.value },
          create: { key: row.key, value: row.value },
        });
      }

      await tx.auditLog.create({
        data: {
          actor,
          action: "settings.updated",
          newValue: Object.fromEntries(
            rows.map((r) => [r.key, r.value])
          ) as Prisma.InputJsonValue,
        },
      });
    });
  }

  return getStoreSettings();
}
