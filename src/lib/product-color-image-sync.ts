import type { Prisma } from "@prisma/client";
import {
  colorImageCreateRows,
  MAX_COLOR_IMAGE_ROWS,
  planColorImageSync,
  type IncomingColorImage,
} from "@/lib/product-color-images";
import { isStoredImageUrl } from "@/lib/uploads";

/**
 * The Prisma half of the per-colour image feature. `lib/product-color-images.ts`
 * decides what should happen; this file checks the request and writes it inside
 * the caller's transaction, so a product save is still all-or-nothing.
 */
export class ColorImageSyncError extends Error {}

export type ColorImageSyncOutcome = {
  created: number;
  updated: number;
  removed: number;
};

const NO_CHANGES: ColorImageSyncOutcome = { created: 0, updated: 0, removed: 0 };

function assertStoredUrl(url: string, colorLabel: string): void {
  if (isStoredImageUrl(url, process.env.SUPABASE_URL)) return;
  const where = colorLabel === "" ? "this product" : `the "${colorLabel}" colour`;
  throw new ColorImageSyncError(
    `"${url}" is not an image the store uploaded, so it cannot be attached to ${where}. Upload it again and retry.`
  );
}

/**
 * Applies a colour-image save. Colours the request does not mention keep their
 * rows, which is what makes retiring and re-adding a colour non-destructive.
 */
export async function syncProductColorImages(
  tx: Prisma.TransactionClient,
  productId: string,
  incoming: readonly IncomingColorImage[] | undefined,
  removeKeys: readonly string[] | undefined
): Promise<ColorImageSyncOutcome> {
  const entries = incoming ?? [];
  const removals = removeKeys ?? [];
  if (entries.length === 0 && removals.length === 0) return { ...NO_CHANGES };

  for (const entry of entries) {
    assertStoredUrl(entry.url, (entry.color ?? "").trim());
  }

  const existing = await tx.productColorImage.findMany({
    where: { productId },
    select: { id: true, colorKey: true, colorLabel: true, url: true, sortOrder: true },
    orderBy: [{ colorKey: "asc" }, { sortOrder: "asc" }],
  });

  const plan = planColorImageSync(existing, entries, removals);
  const after = existing.length - plan.remove.length + plan.create.length;
  if (after > MAX_COLOR_IMAGE_ROWS) {
    throw new ColorImageSyncError(
      `A product can hold at most ${MAX_COLOR_IMAGE_ROWS} colour images (this save would leave ${after}).`
    );
  }
  if (plan.create.length > 0) {
    for (const row of plan.create) assertStoredUrl(row.url, row.colorLabel);
  }

  // Deletes run first: a gallery reorder can move a URL onto a slot that is
  // still occupied, and the unique index is on (productId, colorKey, sortOrder).
  if (plan.remove.length > 0) {
    await tx.productColorImage.deleteMany({ where: { id: { in: plan.remove } } });
  }
  if (plan.create.length > 0) {
    await tx.productColorImage.createMany({
      data: plan.create.map((row) => ({
        productId,
        colorKey: row.colorKey,
        colorLabel: row.colorLabel,
        url: row.url,
        sortOrder: row.sortOrder,
      })),
    });
  }
  for (const row of plan.update) {
    await tx.productColorImage.update({
      where: { id: row.id },
      data: { url: row.url, colorLabel: row.colorLabel },
    });
  }

  return {
    created: plan.create.length,
    updated: plan.update.length,
    removed: plan.remove.length,
  };
}

/** Inserts the colour images supplied with a brand new product. */
export async function createProductColorImages(
  tx: Prisma.TransactionClient,
  productId: string,
  incoming: readonly IncomingColorImage[] | undefined
): Promise<number> {
  const rows = colorImageCreateRows(incoming ?? []).slice(0, MAX_COLOR_IMAGE_ROWS);
  if (rows.length === 0) return 0;
  for (const row of rows) assertStoredUrl(row.url, row.colorLabel);
  await tx.productColorImage.createMany({
    data: rows.map((row) => ({
      productId,
      colorKey: row.colorKey,
      colorLabel: row.colorLabel,
      url: row.url,
      sortOrder: row.sortOrder,
    })),
  });
  return rows.length;
}
