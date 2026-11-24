import type { Prisma } from "@prisma/client";
import { CAPACITY_RELEASING_STATUSES } from "@/lib/order-state-machine";
import {
  describeVariant,
  expandVariantPayload,
  planVariantSync,
  type IncomingVariant,
} from "@/lib/variant-plan";
export {
  variantKey,
  describeVariant,
  expandVariantPayload,
  nextRemainingCapacity,
  planVariantSync,
} from "@/lib/variant-plan";
export type {
  StoredVariant,
  IncomingVariant,
  VariantCapacityConflict,
  VariantSyncPlan,
} from "@/lib/variant-plan";
export class VariantSyncError extends Error { }
export type VariantSyncOutcome = {
  created: number;
  updated: number;
  retired: number;
};
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
  const expanded = expandVariantPayload(incoming);
  const needsLiveOrdered =
    expanded.some((variant) => variant.capacity != null) &&
    existing.some((variant) => variant.capacity === null || variant.remainingCapacity === null);
  const liveOrdered = needsLiveOrdered
    ? await liveOrderedByVariant(tx, productId)
    : new Map<string, number>();
  const plan = planVariantSync(existing, expanded, liveOrdered);
  if (plan.conflicts.length > 0) {
    const conflict = plan.conflicts[0];
    throw new VariantSyncError(
      `Cannot set the capacity of ${describeVariant(conflict)} to ${conflict.requested}: ` +
      `${conflict.consumed} unit(s) are already ordered. A capacity cannot be set below what has been sold.`
    );
  }
  if (plan.update.length > 0) {
    // Group rows that share identical (capacity, remainingCapacity) so bulk edits
    // across dozens of color/size variants execute in a single updateMany query
    // rather than dozens of sequential round-trips inside the transaction.
    const groups = new Map<
      string,
      { capacity: number | null; remainingCapacity: number | null; ids: string[] }
    >();
    for (const row of plan.update) {
      const key = `${row.capacity ?? "null"}|${row.remainingCapacity ?? "null"}`;
      const existingGroup = groups.get(key);
      if (existingGroup) {
        existingGroup.ids.push(row.id);
      } else {
        groups.set(key, {
          capacity: row.capacity,
          remainingCapacity: row.remainingCapacity,
          ids: [row.id],
        });
      }
    }
    for (const group of groups.values()) {
      await tx.productVariant.updateMany({
        where: { id: { in: group.ids } },
        data: {
          active: true,
          capacity: group.capacity,
          remainingCapacity: group.remainingCapacity,
        },
      });
    }
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
