import type { BatchStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseEta, slugifyBatchName } from "@/lib/batches";
import type { BatchUpdateInput, BatchWriteInput } from "@/lib/validation";

/**
 * Writing a batch: the one place the database's vocabulary and the screens'
 * vocabulary meet.
 *
 * Why this module exists rather than a few lines in each route:
 *
 *  1. There were two route trees over one table (`/api/admin/batches` and
 *     `/api/admin/campaigns`) and they disagreed about everything — the field
 *     names, whether a rename is a partial update, and whether a missing slug is
 *     an error. The second tree is gone; these functions are what the surviving
 *     one uses, so the disagreement cannot come back.
 *  2. Both trees had the same destructive bug. `description: description || null`
 *     writes null when the key is merely *absent*, so renaming a batch from a
 *     screen that does not manage the description silently deleted it. Here,
 *     "absent" and "cleared" are deliberately different things.
 */

/** Slug used when a name cannot produce one (an emoji-only name, say). */
export const FALLBACK_BATCH_SLUG = "batch";

/** The columns a batch write may touch, before they reach Prisma. */
export interface BatchWriteData {
  name?: string;
  slug?: string;
  description?: string | null;
  status?: BatchStatus;
  startAt?: Date | null;
  endAt?: Date | null;
  coverImage?: string | null;
  /** Product assignments, when the request carried any. */
  productIds?: string[];
}

/** Was this key actually sent? An absent key and `undefined` are the same thing. */
function present(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/**
 * Maps a validated request body onto the columns the database has.
 *
 * Only keys that were sent appear in the result, so a route can hand the whole
 * object to Prisma and change exactly what the screen manages. Where both
 * spellings arrive — `description` and `notes`, `endAt` and `etaAt` — the
 * canonical one wins, so a client cannot clear a field through its alias.
 *
 * `parseEta` (not `new Date`) is what turns the date values into `Date | null`:
 * it is the helper that knows `""` means "cleared" and that a nonsense value is
 * `null` rather than an Invalid Date, and it is unit-tested for both.
 */
export function normaliseBatchWrite(
  body: Record<string, unknown>,
  parsed: BatchWriteInput | BatchUpdateInput
): BatchWriteData {
  const data: BatchWriteData = {};

  if (present(body, "name") && parsed.name !== undefined) {
    data.name = parsed.name;
  }

  if (present(body, "slug") && parsed.slug !== undefined) {
    data.slug = slugifyBatchName(parsed.slug);
  }

  if (present(body, "description")) {
    data.description = parsed.description || null;
  } else if (present(body, "notes")) {
    data.description = parsed.notes || null;
  }

  if (present(body, "status") && parsed.status !== undefined) {
    data.status = parsed.status;
  }

  if (present(body, "startAt")) {
    data.startAt = parseEta(parsed.startAt);
  }

  if (present(body, "endAt")) {
    data.endAt = parseEta(parsed.endAt);
  } else if (present(body, "etaAt")) {
    data.endAt = parseEta(parsed.etaAt);
  }

  if (present(body, "coverImage")) {
    data.coverImage = parsed.coverImage || null;
  }

  if (present(body, "productIds") && Array.isArray(parsed.productIds)) {
    // De-duplicated here: the unique index on (batchId, productId) would
    // otherwise abort the write *after* the existing assignments were deleted.
    data.productIds = [...new Set(parsed.productIds)];
  }

  return data;
}

/** True when the body asked for nothing, so a route can say so instead of no-op. */
export function isEmptyBatchWrite(data: BatchWriteData): boolean {
  return Object.keys(data).length === 0;
}


/**
 * A slug no other batch has.
 *
 * The slug is the public URL (`/preorder/<slug>`), so it has to be unique and
 * readable. A collision is resolved by counting up — "summer-2026", then
 * "summer-2026-2" — rather than by appending a random suffix, because a human
 * may have to type or share the result.
 */
export async function uniqueBatchSlug(desired: string, excludeId?: string): Promise<string> {
  const base = slugifyBatchName(desired) || FALLBACK_BATCH_SLUG;

  for (let attempt = 1; attempt < 100; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;
    const clash = await prisma.batch.findFirst({
      where: {
        slug: candidate,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (!clash) return candidate;
  }

  // Unreachable in practice; kept so the function always returns a free slug
  // rather than undefined if a store somehow holds 99 identically named batches.
  return `${base}-${Date.now().toString(36)}`;
}

/** A rejected write that is the caller's fault, not the server's. */
export class BatchWriteError extends Error {}

/** Throws a 400-shaped error for product ids that do not exist. */
export async function assertProductsExist(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const found = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });

  if (found.length === ids.length) return;

  const known = new Set(found.map((product) => product.id));
  const missing = ids.filter((id) => !known.has(id));
  throw new BatchWriteError(
    `Unknown product id${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`
  );
}

/**
 * Replaces a batch's product list inside the caller's transaction.
 *
 * Delete-then-insert is not safe on its own: if the insert fails (a product that
 * no longer exists, a duplicate id) the batch is left with no products at all,
 * which makes every order already placed against it unfulfillable — the order
 * was accepted because its product was in the batch, and now it is not. Both
 * halves run in one transaction so the swap is all-or-nothing.
 */
export async function syncBatchProducts(
  tx: Prisma.TransactionClient,
  batchId: string,
  productIds: string[]
): Promise<void> {
  await tx.batchProduct.deleteMany({ where: { batchId } });
  if (productIds.length === 0) return;

  await tx.batchProduct.createMany({
    data: productIds.map((productId) => ({ batchId, productId })),
    skipDuplicates: true,
  });
}

/**
 * Makes sure a product is part of a batch, so that it can actually be ordered.
 *
 * The order service refuses an item whose product is not in the batch being
 * ordered (`PRODUCT_NOT_IN_BATCH`), and that check is right: it stops a customer
 * from ordering a product into the wrong drop. What was missing was a *write
 * path* that puts a product into a batch.
 *
 * Creating a product already does this (`POST /api/admin/products` links the new
 * product to the newest open batch "so it is live on the storefront"). The
 * storefront page used to make up the difference at render time instead, by
 * inserting the missing join while a customer was reading the page - a write on
 * a read path, run twice per request, with every error swallowed. The repair
 * belongs here, on a write path, behind `products.write`, where the rest of the
 * catalogue already lives.
 *
 * A product that is in a batch is left alone: this fills a hole, it never
 * overrides a choice an operator has made.
 */
export async function ensureProductInOpenBatch(
  tx: Prisma.TransactionClient,
  productId: string
): Promise<string | null> {
  const linked = await tx.batchProduct.findFirst({
    where: { productId },
    select: { batchId: true },
  });
  if (linked) return linked.batchId;

  const openBatch = await tx.batch.findFirst({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!openBatch) return null;

  await tx.batchProduct.createMany({
    data: [{ batchId: openBatch.id, productId }],
    skipDuplicates: true,
  });

  return openBatch.id;
}
