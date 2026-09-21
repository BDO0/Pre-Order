import type { Prisma } from "@prisma/client";
import { CAPACITY_RELEASING_STATUSES } from "@/lib/order-state-machine";

/**
 * Variant writes: the one place that decides what happens to a product's
 * variants.
 *
 * This module exists because of what the old PATCH handler did:
 *
 *   await prisma.productVariant.deleteMany({ where: { productId: id } });
 *   await prisma.productVariant.createMany({ data: variants.map(...) });
 *
 * Three things were wrong with that, and all three are customer-visible:
 *
 *  1. `order_items.variantId` is a required foreign key with no `onDelete`, so
 *     Postgres refuses to delete a variant any order refers to. Saving the sizes
 *     of a product that had ever been ordered threw P2003, and because the
 *     product row itself had already been updated, the operator got a 500 from a
 *     form that had in fact half-saved.
 *  2. Every recreated variant was written with `remainingCapacity = capacity`,
 *     so saving a product quietly refilled the stock its orders had consumed.
 *  3. Clearing the size list was a no-op, while the form promised that the sizes
 *     "replace all existing variants".
 *
 * The fix is to stop treating a variant as disposable. A variant is identified
 * by its size and colour; the ones that disappear from the form are retired
 * (`active: false`, which the storefront query and the order service already
 * filter on) instead of deleted, so paid orders keep their foreign key and an
 * operator can undo a mistake by putting the size back.
 */

/** A variant as it is stored, as far as a sync needs to know. */
export interface StoredVariant {
  id: string;
  size: string | null;
  color: string | null;
  capacity: number | null;
  remainingCapacity: number | null;
  active: boolean;
}

/**
 * A variant as the admin screens send it.
 *
 * A key that is absent means "leave this alone": the product form manages sizes
 * and colours, and never capacity. Writing `capacity: null` for every variant on
 * every save is how the stock counter was reset in the first place.
 */
export interface IncomingVariant {
  size?: string | null;
  color?: string | null;
  capacity?: number | null;
}

/** The identity of a variant: colour and size, trimmed and case-folded. */
export function variantKey(
  size: string | null | undefined,
  color: string | null | undefined
): string {
  return `${(color ?? "").trim().toLowerCase()}|${(size ?? "").trim().toLowerCase()}`;
}

/** A variant, named the way an operator would recognise it in an error. */
export function describeVariant(variant: {
  size: string | null;
  color: string | null;
}): string {
  const parts = [variant.color, variant.size].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "the default variant";
}

/**
 * What `remainingCapacity` becomes when `capacity` is set to `newCapacity`.
 *
 * `capacity - remainingCapacity` is the number of units already claimed by live
 * orders, and `npm run db:check` compares exactly that against the order items.
 * So the new remaining is the new capacity *minus what is already sold*, never
 * the new capacity on its own: setting the capacity is admitting more stock, not
 * unselling what has been sold.
 *
 * A variant that had no capacity (unlimited) has no stored pair to measure, so
 * the caller passes the live order count instead - the same number `db:check`
 * measures the same way.
 */
export function nextRemainingCapacity(
  oldCapacity: number | null,
  oldRemaining: number | null,
  newCapacity: number | null,
  liveOrdered = 0
): number | null {
  if (newCapacity === null) return null;

  const consumed =
    oldCapacity !== null && oldRemaining !== null
      ? Math.max(0, oldCapacity - oldRemaining)
      : Math.max(0, liveOrdered);

  return Math.max(0, newCapacity - consumed);
}

/** A requested capacity that orders already placed make impossible. */
export interface VariantCapacityConflict {
  size: string | null;
  color: string | null;
  requested: number;
  consumed: number;
}

/** Everything a sync is going to do, decided without touching the database. */
export interface VariantSyncPlan {
  create: { size: string | null; color: string | null; capacity: number | null }[];
  update: { id: string; capacity: number | null; remainingCapacity: number | null }[];
  deactivate: string[];
  conflicts: VariantCapacityConflict[];
}

/**
 * Decides the whole sync from the stored rows and the incoming ones.
 *
 * Pure, so the cases that matter - a size that disappears, a capacity that
 * changes, a size that comes back - are testable without a database.
 */
export function planVariantSync(
  existing: StoredVariant[],
  incoming: IncomingVariant[],
  liveOrdered: Map<string, number> = new Map()
): VariantSyncPlan {
  const plan: VariantSyncPlan = { create: [], update: [], deactivate: [], conflicts: [] };

  // The form builds one row per size, but a hand-written request can repeat one.
  // Last one wins, so a later row corrects an earlier one instead of the two
  // fighting over the same stored variant.
  const wanted = new Map<string, IncomingVariant>();
  for (const variant of incoming) {
    wanted.set(variantKey(variant.size, variant.color), variant);
  }

  // The table has no unique index on (productId, size, color), so one key can
  // own more than one stored row. The oldest keeps the identity; the extras are
  // retired rather than deleted, because an extra row holding its own invisible
  // stock counter is worse than a retired one.
  const byKey = new Map<string, StoredVariant[]>();
  for (const variant of existing) {
    const key = variantKey(variant.size, variant.color);
    const rows = byKey.get(key);
    if (rows) rows.push(variant);
    else byKey.set(key, [variant]);
  }

  for (const [key, rows] of byKey) {
    const [survivor, ...duplicates] = rows;
    for (const duplicate of duplicates) {
      if (duplicate.active) plan.deactivate.push(duplicate.id);
    }

    const request = wanted.get(key);
    if (!request) {
      if (survivor.active) plan.deactivate.push(survivor.id);
      continue;
    }

    const hasCapacity = Object.prototype.hasOwnProperty.call(request, "capacity");
    const requested = hasCapacity ? request.capacity ?? null : survivor.capacity;
    const live = liveOrdered.get(survivor.id) ?? 0;

    const consumed =
      survivor.capacity !== null && survivor.remainingCapacity !== null
        ? Math.max(0, survivor.capacity - survivor.remainingCapacity)
        : live;

    // Selling 6 and then declaring a capacity of 3 is not a state the database
    // can hold honestly: `capacity - remainingCapacity` would no longer be the
    // units on live orders, which is what `db:check` reconciles. Refuse it.
    if (hasCapacity && requested !== null && requested < consumed) {
      plan.conflicts.push({
        size: survivor.size,
        color: survivor.color,
        requested,
        consumed,
      });
      continue;
    }

    const remaining = hasCapacity
      ? nextRemainingCapacity(
          survivor.capacity,
          survivor.remainingCapacity,
          requested,
          live
        )
      : survivor.remainingCapacity;

    // Nothing to write when a live variant already holds the capacity it is
    // being given: the common case of renaming a product, which must not touch
    // a stock counter at all.
    if (
      survivor.active &&
      requested === survivor.capacity &&
      remaining === survivor.remainingCapacity
    ) {
      continue;
    }

    plan.update.push({ id: survivor.id, capacity: requested, remainingCapacity: remaining });
  }

  for (const [key, request] of wanted) {
    if (byKey.has(key)) continue;
    plan.create.push({
      size: request.size ?? null,
      color: request.color ?? null,
      capacity: request.capacity ?? null,
    });
  }

  return plan;
}

/** A rejected variant write that is the caller's fault, not the server's. */
export class VariantSyncError extends Error {}

/**
 * What a sync did, so a route can say so instead of implying it.
 *
 * A type alias rather than an interface on purpose: this object is written into
 * the audit log, and only a type alias is assignable to Prisma's `InputJsonValue`
 * (an interface has no implicit index signature).
 */
export type VariantSyncOutcome = {
  created: number;
  updated: number;
  retired: number;
};

/**
 * Units each variant has out with live orders.
 *
 * The same definition `npm run db:check` reconciles against: an order holds its
 * capacity until it is cancelled or rejected, and stops counting after that.
 */
async function liveOrderedByVariant(
  tx: Prisma.TransactionClient,
  productId: string
): Promise<Map<string, number>> {
  const rows = await tx.orderItem.groupBy({
    by: ["variantId"],
    where: {
      variant: { productId },
      order: { status: { notIn: CAPACITY_RELEASING_STATUSES } },
    },
    _sum: { quantity: true },
  });

  return new Map(rows.map((row) => [row.variantId, row._sum.quantity ?? 0]));
}

/**
 * Brings a product's variants in line with the list a screen just sent.
 *
 * Runs inside the caller's transaction, so a rejected capacity or a failed
 * insert cannot leave the product half-saved - which is exactly what the old
 * delete-then-recreate version did once Postgres refused the delete.
 *
 * Nothing here deletes a variant. `order_items.variantId` is a required foreign
 * key, so a variant an order refers to can never be removed; retiring it takes
 * it off the storefront and out of the order service, which both read
 * `active: true`, without touching the order that was already paid for.
 */
export async function syncProductVariants(
  tx: Prisma.TransactionClient,
  productId: string,
  incoming: IncomingVariant[]
): Promise<VariantSyncOutcome> {
  const existing = await tx.productVariant.findMany({
    where: { productId },
    select: {
      id: true,
      size: true,
      color: true,
      capacity: true,
      remainingCapacity: true,
      active: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Only needed when a capacity is actually being set on a variant that has no
  // stored pair to measure consumption from.
  const liveOrdered = incoming.some((variant) => variant.capacity != null)
    ? await liveOrderedByVariant(tx, productId)
    : new Map<string, number>();

  const plan = planVariantSync(existing, incoming, liveOrdered);

  if (plan.conflicts.length > 0) {
    const conflict = plan.conflicts[0];
    throw new VariantSyncError(
      `Cannot set the capacity of ${describeVariant(conflict)} to ${conflict.requested}: ` +
        `${conflict.consumed} unit(s) are already ordered. A capacity cannot be set below what has been sold.`
    );
  }

  for (const row of plan.update) {
    await tx.productVariant.update({
      where: { id: row.id },
      data: {
        active: true,
        capacity: row.capacity,
        remainingCapacity: row.remainingCapacity,
      },
    });
  }

  if (plan.deactivate.length > 0) {
    await tx.productVariant.updateMany({
      where: { id: { in: plan.deactivate } },
      data: { active: false },
    });
  }

  if (plan.create.length > 0) {
    await tx.productVariant.createMany({
      data: plan.create.map((variant) => ({
        productId,
        size: variant.size,
        color: variant.color,
        // A brand new variant has consumed nothing, so its remaining capacity is
        // its full capacity. This is the only place the two are ever equal.
        capacity: variant.capacity,
        remainingCapacity: variant.capacity,
        active: true,
      })),
    });
  }

  return {
    created: plan.create.length,
    updated: plan.update.length,
    retired: plan.deactivate.length,
  };
}

