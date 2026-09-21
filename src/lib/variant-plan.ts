/**
 * Everything about a product's variant list that needs no database.
 *
 * Two halves that belong together:
 *
 *  - **The form side.** Turning the "S, M, L" and "Black, White" boxes on the
 *    product screens into the variant rows the API is sent, and reading the
 *    stock box beside each one.
 *  - **The rule side.** What a save should do to the rows already stored, as a
 *    plan that can be inspected before a single write happens.
 *
 * They share a module because the edit screen has to *preview* that plan. The
 * form used to rebuild every variant from the colour of its first row, so saving
 * a two-colour product retired the other colour and said nothing about it. A
 * screen that can ask "what would this save retire?" cannot make that mistake
 * quietly. The same gap left `capacity` out of both forms entirely, so every
 * product an operator created was unlimited and the "without overselling"
 * promise held only for the rows `prisma/seed.ts` had written.
 *
 * Nothing here imports anything, which is what lets a client component use it -
 * the same reason `order-answers.ts` is written this way - and what makes every
 * rule testable without a database. The writes themselves live in
 * `product-variants.ts`, which re-exports these names for its own callers.
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
 * An absent key means "leave this alone". The product forms now always send
 * `capacity`, so an empty stock box means "no limit" rather than "unchanged" -
 * but a hand-written request that omits the key still leaves the counter
 * untouched, and `planVariantSync` keeps the two cases apart. Writing
 * `capacity: null` for every variant on every save is how the stock counter was
 * reset in the first place.
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

// ─────────────────────────────────────────────────────────────
// THE FORM SIDE
// ─────────────────────────────────────────────────────────────

/** The most options one product may have, from `productVariantListSchema`. */
export const MAX_VARIANTS = 200;

/**
 * Splits a delimiter-separated input into distinct values.
 *
 * Supports commas (`,`), full-width commas (`，`), semicolons (`;`), and newlines (`\n`, `\r`).
 * Case is folded for the comparison only, and the first spelling wins: "Black,
 * black" is one option called "Black". `variantKey` folds case anyway, so a
 * duplicate row would be quietly collapsed by the sync after the operator had
 * watched it appear in the grid.
 */
export function parseVariantList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const values: string[] = [];

  for (const part of raw.split(/[\n\r,;\uFF0C]+/)) {
    const value = part.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }

  return values;
}

/**
 * Normalises an incoming variant list, expanding any row whose size or colour
 * was sent as a comma-separated list into distinct variant rows.
 *
 * For example: `{ color: "Black, Red, Blue", size: "M", capacity: 10 }`
 * expands to 3 variants:
 *   - M / Black (capacity: 10)
 *   - M / Red (capacity: 10)
 *   - M / Blue (capacity: 10)
 */
export function expandVariantPayload<
  T extends { size?: string | null; color?: string | null; capacity?: number | null }
>(variants: readonly T[]): T[] {
  const result: T[] = [];
  const seenKeys = new Set<string>();

  for (const v of variants) {
    const sizes = v.size ? parseVariantList(v.size) : [null];
    const colors = v.color ? parseVariantList(v.color) : [null];

    const sizeList = sizes.length > 0 ? sizes : [null];
    const colorList = colors.length > 0 ? colors : [null];

    for (const color of colorList) {
      for (const size of sizeList) {
        const key = variantKey(size, color);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        result.push({
          ...v,
          size,
          color,
        });
      }
    }
  }

  return result;
}

/** One option on a product: a size, a colour, or both. */
export interface VariantDraft {
  size: string | null;
  color: string | null;
}

/**
 * Every combination of the sizes and colours the operator typed.
 *
 * Colour is the outer loop so the grid reads the way the storefront lists the
 * options - colour first, then size - which is also how the API sorts them.
 *
 * Both boxes empty is an empty list, not one nameless option: the screens
 * promise that saving replaces the option list, and an empty list is the honest
 * spelling of "no options". One box filled and the other empty is *not* empty -
 * a product that comes in one colour and has no sizes is a real product.
 */
export function buildVariantMatrix(sizes: string[], colors: string[]): VariantDraft[] {
  if (sizes.length === 0 && colors.length === 0) return [];

  const sizeList: (string | null)[] = sizes.length > 0 ? sizes : [null];
  const colorList: (string | null)[] = colors.length > 0 ? colors : [null];

  const rows: VariantDraft[] = [];
  for (const color of colorList) {
    for (const size of sizeList) {
      rows.push({ size, color });
    }
  }

  return rows;
}

/** One row of the stock grid: an option plus what is typed in its stock box. */
export interface VariantFormRow extends VariantDraft {
  /** The raw text of the stock box. Blank means "no limit". */
  capacity: string;
}

/**
 * Reads one stock box.
 *
 * Blank is `null`, which means unlimited. Anything that is not a whole number of
 * at least one is an error rather than a silent `null`: turning "3o" into "no
 * limit" would be the same class of quiet mistake as the field this replaces.
 */
export function parseCapacityInput(
  raw: string
): { ok: true; capacity: number | null } | { ok: false; message: string } {
  const text = raw.trim();
  if (text === "") return { ok: true, capacity: null };

  const value = Number(text);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, message: `"${text}" is not a whole number.` };
  }

  if (value < 1) {
    return {
      ok: false,
      message: `${text} is not enough to take a single order. Leave it empty for no limit.`,
    };
  }

  return { ok: true, capacity: value };
}

/**
 * Turns the form's rows into the `variants` array the API expects.
 *
 * Shared by the create and edit screens so the two cannot send the same form in
 * two different shapes. The first problem is returned instead of a partial list,
 * because a half-valid variant list is exactly what retires options the operator
 * never touched.
 */
export function buildVariantPayload(
  rows: VariantFormRow[]
): { ok: true; variants: IncomingVariant[] } | { ok: false; message: string } {
  if (rows.length > MAX_VARIANTS) {
    return {
      ok: false,
      message: `That is ${rows.length} options, and one product can hold ${MAX_VARIANTS}. Split it into two products.`,
    };
  }

  const variants: IncomingVariant[] = [];
  for (const row of rows) {
    const capacity = parseCapacityInput(row.capacity);
    if (!capacity.ok) {
      return { ok: false, message: `Stock for ${describeVariant(row)}: ${capacity.message}` };
    }
    variants.push({ size: row.size, color: row.color, capacity: capacity.capacity });
  }

  return { ok: true, variants };
}

/**
 * The options a save would retire, named for an operator to read.
 *
 * The edit screen asks this before it sends anything, so a save that is about to
 * take a colour off the storefront says so first. It is a preview of
 * `planVariantSync`, not a second opinion: both call the same function.
 */
export function describeRetirements(
  existing: StoredVariant[],
  incoming: IncomingVariant[]
): string[] {
  const byId = new Map(existing.map((variant) => [variant.id, variant]));

  return planVariantSync(existing, incoming).deactivate.map((id) => {
    const variant = byId.get(id);
    return variant ? describeVariant(variant) : id;
  });
}


