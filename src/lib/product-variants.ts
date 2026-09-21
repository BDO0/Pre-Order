import type { Prisma } from "@prisma/client";
import { CAPACITY_RELEASING_STATUSES } from "@/lib/order-state-machine";
import { describeVariant, planVariantSync, type IncomingVariant } from "@/lib/variant-plan";

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
 *
 * The rules themselves are pure and live in `variant-plan.ts` - the product
 * screens import that module to preview what a save is about to retire, and a
 * client component must not import this one. What is left here is the part that
 * touches the database.
 */

/**
 * Re-exported so the pure rules keep exactly one home.
 *
 * `planVariantSync`, `variantKey` and the rest are `variant-plan.ts`'s and used
 * to be defined here. Callers that only ever knew about this module - the tests,
 * mostly - still get them from here rather than from the new one.
 */
export {
  variantKey,
  describeVariant,
  nextRemainingCapacity,
  planVariantSync,
} from "@/lib/variant-plan";

export type {
  StoredVariant,
  IncomingVariant,
  VariantCapacityConflict,
  VariantSyncPlan,
} from "@/lib/variant-plan";

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
 *
 * What to do is decided by `planVariantSync` in `variant-plan.ts`, in full,
 * before anything is written - so the product screens can show the operator the
 * same plan. This function is only the writing of it.
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

