/**
 * The capacity invariants, in one place.
 *
 * Two callers need the same answers and must never disagree about them:
 * `npm run db:check` prints them so a person can look, and
 * `npm run demo:purge` refuses to finish unless every one still holds after it
 * has deleted rows and recomputed stock. A purge that verified itself against
 * its own copy of these rules could drift from the copy an operator runs by
 * hand, and the copy that drifts is always the one nobody reads.
 *
 * Pure by design — rows in, findings out. No Prisma, no console, no `process`.
 * The callers differ only in how they *report* a finding, and in which statuses
 * they treat as still holding stock: that list is
 * `CAPACITY_RELEASING_STATUSES` in `order-state-machine.ts`, and both callers
 * filter with it rather than restating it.
 */

import type { OrderStatus } from "@prisma/client";
import { CAPACITY_RELEASING_STATUSES } from "./order-state-machine";

/** A variant, reduced to the columns the invariants talk about. */
export interface VariantCapacityRow {
  id: string;
  productId: string;
  size: string | null;
  color: string | null;
  capacity: number | null;
  remainingCapacity: number | null;
}

/** A product, reduced to its pre-order limit and what it has handed out. */
export interface ProductReservedRow {
  id: string;
  slug: string;
  preorderLimit: number | null;
  preorderReserved: number;
}

/** One order item that still holds stock. */
export interface ItemHold {
  variantId: string;
  quantity: number;
}

/** An order with no items at all: it can never have claimed anything. */
export interface EmptyOrderRow {
  reference: string;
  status: string;
}

/**
 * The rules, in the order they are reported.
 *
 * Named constants rather than inline strings so a caller can key off one
 * (`RULES.variantConsumedMatches`) and a test can assert that every rule is
 * still produced — a refactor that silently dropped one would otherwise look
 * like a clean run.
 */
export const RULES = {
  variantNotNegative: "no variant has a negative remainingCapacity",
  variantWithinCapacity: "no variant holds more remaining than its capacity",
  variantBothOrNeither: "capacity and remainingCapacity are both set or both NULL",
  productNotNegative: "no product has a negative preorderReserved",
  productWithinLimit: "no product has reserved more than its preorderLimit",
  orderHasItems: "every order has at least one item",
  variantConsumedMatches: "variant capacity consumed matches live order items",
  productReservedMatches: "product preorderReserved matches live order items",
} as const;

/** Every rule, in report order. */
export const AUDITED_RULES: readonly string[] = [
  RULES.variantNotNegative,
  RULES.variantWithinCapacity,
  RULES.variantBothOrNeither,
  RULES.productNotNegative,
  RULES.productWithinLimit,
  RULES.orderHasItems,
  RULES.variantConsumedMatches,
  RULES.productReservedMatches,
];

/** One rule's verdict: which rule, whether it held, and what broke it. */
export interface CapacityFinding {
  /** One of RULES. */
  rule: string;
  pass: boolean;
  /** What is wrong, named by row, or undefined when the rule holds. */
  detail?: string;
}

/** How a variant is named in a finding: the id plus what the operator sees. */
export function variantLabel(v: VariantCapacityRow): string {
  const shape = [v.color, v.size].filter(Boolean).join("/") || "no size";
  return `${v.id} (${shape})`;
}

/**
 * Total quantity held per variant.
 *
 * The caller decides which items still hold stock (see
 * `CAPACITY_RELEASING_STATUSES`); this only adds them up, so both callers count
 * the same way.
 */
export function heldQuantityByVariant(items: readonly ItemHold[]): Map<string, number> {
  const held = new Map<string, number>();
  for (const item of items) {
    held.set(item.variantId, (held.get(item.variantId) ?? 0) + item.quantity);
  }
  return held;
}

/**
 * The ids of the orders that still hold stock.
 *
 * One definition of "still holding", used everywhere: a caller filters its
 * order items through this, so a status added to `CAPACITY_RELEASING_STATUSES`
 * cannot leave one part of the app counting a voided order and another part
 * counting it as sold.
 */
export function holdingOrderIds(orders: readonly { id: string; status: string }[]): Set<string> {
  return new Set(
    orders
      .filter((order) => !CAPACITY_RELEASING_STATUSES.includes(order.status as OrderStatus))
      .map((order) => order.id)
  );
}

/** Total quantity held per product, from the same per-variant totals. */
export function heldQuantityByProduct(
  variants: readonly VariantCapacityRow[],
  heldByVariant: ReadonlyMap<string, number>
): Map<string, number> {
  const productOfVariant = new Map(variants.map((v) => [v.id, v.productId]));
  const heldByProduct = new Map<string, number>();

  for (const [variantId, quantity] of heldByVariant) {
    const productId = productOfVariant.get(variantId);
    if (productId) heldByProduct.set(productId, (heldByProduct.get(productId) ?? 0) + quantity);
  }

  return heldByProduct;
}

/**
 * What a variant's `remainingCapacity` would be if it were derived from the
 * live order items rather than remembered: capacity minus everything claimed.
 *
 * A negative answer is real information — it means the stored capacity is wrong
 * by more than the stock that exists — so it is returned rather than clamped to
 * zero, which would hide an oversell.
 */
export function derivedRemainingCapacity(variant: VariantCapacityRow, held: number): number | null {
  if (variant.capacity === null) return null;
  return variant.capacity - held;
}

/**
 * What a product's `preorderReserved` would be, derived the same way.
 *
 * There is nothing to derive it *from* beyond the items, which is the point:
 * the column is a cache of this sum, and this function is the definition of it.
 */
export function derivedPreorderReserved(heldForProduct: number): number {
  return heldForProduct;
}

/** Joins names for a one-line detail, with a count instead of an endless list. */
export function list(values: readonly string[], limit = 5): string {
  const shown = values.slice(0, limit).join(", ");
  return values.length > limit ? `${shown}, +${values.length - limit} more` : shown;
}

/**
 * Every capacity rule, checked.
 *
 * One finding per rule, always, so a caller can print a line for each and a
 * reader can see that eight rules ran rather than trusting that none fired.
 */
export function auditCapacity(input: {
  variants: readonly VariantCapacityRow[];
  products: readonly ProductReservedRow[];
  items: readonly ItemHold[];
  emptyOrders: readonly EmptyOrderRow[];
}): CapacityFinding[] {
  const { variants, products, items, emptyOrders } = input;

  const negative = variants.filter(
    (v) => v.remainingCapacity !== null && v.remainingCapacity < 0
  );
  const overCapacity = variants.filter(
    (v) => v.capacity !== null && v.remainingCapacity !== null && v.remainingCapacity > v.capacity
  );
  const halfNull = variants.filter((v) => (v.capacity === null) !== (v.remainingCapacity === null));
  const negativeReserved = products.filter((p) => p.preorderReserved < 0);
  const overLimit = products.filter(
    (p) => p.preorderLimit !== null && p.preorderReserved > p.preorderLimit
  );

  const heldByVariant = heldQuantityByVariant(items);
  const heldByProduct = heldQuantityByProduct(variants, heldByVariant);

  // The two reconciliation rules are the ones that matter after a purge: they
  // compare what the database *remembers* holding against what the orders say
  // is held, which is exactly the pair a half-finished deletion would break.
  const variantMismatch: string[] = [];
  for (const v of variants) {
    // A variant with no capacity is unlimited: only the product's pre-order
    // limit bounds it, and that is reconciled by the next rule.
    if (v.capacity === null || v.remainingCapacity === null) continue;
    const stored = v.capacity - v.remainingCapacity;
    const live = heldByVariant.get(v.id) ?? 0;
    if (stored !== live) variantMismatch.push(`${variantLabel(v)}: stored ${stored} vs live ${live}`);
  }

  const productMismatch: string[] = [];
  for (const p of products) {
    const live = heldByProduct.get(p.id) ?? 0;
    if (p.preorderReserved !== live) {
      productMismatch.push(`${p.slug}: stored ${p.preorderReserved} vs live ${live}`);
    }
  }

  return [
    {
      rule: RULES.variantNotNegative,
      pass: negative.length === 0,
      detail: negative.length === 0 ? undefined : list(negative.map(variantLabel)),
    },
    {
      rule: RULES.variantWithinCapacity,
      pass: overCapacity.length === 0,
      detail:
        overCapacity.length === 0
          ? undefined
          : list(
              overCapacity.map((v) => `${variantLabel(v)}: ${v.remainingCapacity}/${v.capacity}`)
            ),
    },
    {
      rule: RULES.variantBothOrNeither,
      pass: halfNull.length === 0,
      detail: halfNull.length === 0 ? undefined : list(halfNull.map(variantLabel)),
    },
    {
      rule: RULES.productNotNegative,
      pass: negativeReserved.length === 0,
      detail: negativeReserved.length === 0 ? undefined : list(negativeReserved.map((p) => p.slug)),
    },
    {
      rule: RULES.productWithinLimit,
      pass: overLimit.length === 0,
      detail:
        overLimit.length === 0
          ? undefined
          : list(overLimit.map((p) => `${p.slug}: ${p.preorderReserved}/${p.preorderLimit}`)),
    },
    {
      rule: RULES.orderHasItems,
      pass: emptyOrders.length === 0,
      detail:
        emptyOrders.length === 0
          ? undefined
          : list(emptyOrders.map((o) => `${o.reference} (${o.status})`)),
    },
    {
      rule: RULES.variantConsumedMatches,
      pass: variantMismatch.length === 0,
      detail: variantMismatch.length === 0 ? undefined : list(variantMismatch),
    },
    {
      rule: RULES.productReservedMatches,
      pass: productMismatch.length === 0,
      detail: productMismatch.length === 0 ? undefined : list(productMismatch),
    },
  ];
}
