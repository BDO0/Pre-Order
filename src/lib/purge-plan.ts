/**
 * What counts as demo data, and how a purge of it is worked out.
 *
 * Pure: no Prisma, no filesystem, no console. `scripts/purge-demo-data.ts`
 * reads rows, hands them here, and acts on the answer; the tests replay the
 * same functions over literal rows. That split is the point — the question
 * "does this select exactly the demo shop and nothing else?" is answerable
 * without a database, and answering it against the *live* database is not an
 * option.
 *
 * Nothing here deletes anything, and every list it returns is a list of rows
 * that were handed to it: it cannot invent an id.
 */
import {
  derivedPreorderReserved,
  derivedRemainingCapacity,
  heldQuantityByProduct,
  heldQuantityByVariant,
  holdingOrderIds,
} from "./capacity-audit";

/**
 * The three products `prisma/seed.ts` writes: `npm run db:seed:demo`.
 *
 * Kept in step with that file by hand, because a list that read the seed at
 * runtime would select whatever the seed says *now* rather than what is in the
 * database, and the whole point is to name rows that are already there.
 */
export const SEEDED_DEMO_PRODUCT_SLUGS: readonly string[] = [
  "oversized-cotton-shirt",
  "korean-cargo-pants",
  "basic-tee",
];

/**
 * Products made by hand while the app was being readied: one picture, a price
 * and some sizes, created through the admin panel to see whether the screens
 * worked.
 *
 * They are named explicitly rather than matched by a rule like "has no images"
 * or "was created before the launch date", because every such rule eventually
 * matches something an operator meant to keep. These two slugs are the tests.
 */
export const SMOKE_TEST_PRODUCT_SLUGS: readonly string[] = ["parka", "sweatshirt"];

/** Everything the purge treats as demo stock unless `--keep` says otherwise. */
export const DEMO_PRODUCT_SLUGS: readonly string[] = [
  ...SEEDED_DEMO_PRODUCT_SLUGS,
  ...SMOKE_TEST_PRODUCT_SLUGS,
];

/** The demo drop: the only batch `prisma/seed.ts` creates. */
export const DEMO_BATCH_SLUGS: readonly string[] = ["september-drop-2026"];

/**
 * Handle prefixes that are only ever produced by a test.
 *
 * A customer row is deleted when every order it has is going with the demo
 * data, or when its handle carries one of these prefixes and it has no orders
 * at all. A real customer who has not ordered yet must not be swept up, which
 * is why the no-orders case needs the prefix rather than "has no orders".
 */
export const TEST_HANDLE_PREFIXES: readonly string[] = ["e2e.probe.", "probe."];

/**
 * The actor an ad-hoc probe wrote into `audit_logs` (`probe-bf6fe581@local.test`).
 *
 * No script in this repository produces it: those rows came from a throwaway
 * harness, and they are the only audit rows that describe entities which no
 * longer exist. Named here so the dry run can list them rather than the purge
 * guessing at which history is disposable.
 */
export const TEST_ACTOR_PREFIX = "probe-";

export interface PurgeProductRow {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  preorderStatus: string;
  images: readonly string[];
  /** A cap on the whole product. Cached; the limit itself is operator input. */
  preorderLimit: number | null;
  /** Cached from the order items; re-derived by `planCapacityRecompute`. */
  preorderReserved: number;
  createdAt: Date;
}

export interface PurgeVariantRow {
  id: string;
  productId: string;
  size: string | null;
  color: string | null;
  capacity: number | null;
  remainingCapacity: number | null;
}

export interface PurgeBatchRow {
  id: string;
  slug: string;
  name: string;
  status: string;
}

export interface PurgeBatchProductRow {
  batchId: string;
  productId: string;
}

export interface PurgeOrderRow {
  id: string;
  reference: string;
  status: string;
  batchId: string;
  customerId: string | null;
  createdAt: Date;
}

export interface PurgeOrderItemRow {
  id: string;
  orderId: string;
  variantId: string;
  quantity: number;
}

export interface PurgeStatusHistoryRow {
  id: string;
  orderId: string;
}

export interface PurgeAuditLogRow {
  id: string;
  orderId: string | null;
  actor: string;
  action: string;
  createdAt: Date;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: unknown;
}

export interface PurgeCustomerRow {
  id: string;
  instagramHandle: string;
  fullName: string;
  createdAt: Date;
}

/** Every row the purge looks at, exactly as the caller read them. */
export interface PurgeInput {
  products: readonly PurgeProductRow[];
  variants: readonly PurgeVariantRow[];
  batches: readonly PurgeBatchRow[];
  batchProducts: readonly PurgeBatchProductRow[];
  orders: readonly PurgeOrderRow[];
  orderItems: readonly PurgeOrderItemRow[];
  statusHistory: readonly PurgeStatusHistoryRow[];
  auditLogs: readonly PurgeAuditLogRow[];
  customers: readonly PurgeCustomerRow[];
}

export interface PurgeOptions {
  /** Slugs to purge. Defaults to DEMO_PRODUCT_SLUGS. */
  productSlugs?: readonly string[];
  /** Batch slugs to purge. Defaults to DEMO_BATCH_SLUGS. */
  batchSlugs?: readonly string[];
  keepProductSlugs?: readonly string[];
  keepBatchSlugs?: readonly string[];
  keepOrderRefs?: readonly string[];
  keepHandles?: readonly string[];
  /** Handles to remove even though they have no orders to take with them. */
  purgeHandles?: readonly string[];
}

/** A row that was considered and refused, with the sentence explaining why. */
export interface BlockedRow {
  label: string;
  reason: string;
}

/**
 * Works out what the purge would remove, and why.
 *
 * The order of the work matters. Products come first, because everything else
 * hangs off them. Then the orders that sit entirely on those products' variants
 * — an order is what makes a variant un-deletable. Then a refinement pass,
 * because holding an order back can in turn save a product that its other items
 * point at. Only once that settles do the counts mean anything.
 */
export function planPurge(input: PurgeInput, options: PurgeOptions = {}): PurgePlan {
  const keepProducts = new Set(options.keepProductSlugs ?? []);
  const keepBatches = new Set(options.keepBatchSlugs ?? []);
  const keepOrders = new Set(options.keepOrderRefs ?? []);
  const keepHandles = new Set((options.keepHandles ?? []).map((h) => h.toLowerCase()));
  const purgeHandles = new Set((options.purgeHandles ?? []).map((h) => h.toLowerCase()));
  const productSlugs = options.productSlugs ?? DEMO_PRODUCT_SLUGS;
  const batchSlugs = options.batchSlugs ?? DEMO_BATCH_SLUGS;

  const notes: string[] = [];
  const blocked: BlockedRow[] = [];
  const kept: BlockedRow[] = [];

  const productBySlug = new Map(input.products.map((p) => [p.slug, p]));
  const batchBySlug = new Map(input.batches.map((b) => [b.slug, b]));
  const variantById = new Map(input.variants.map((v) => [v.id, v]));
  const orderById = new Map(input.orders.map((o) => [o.id, o]));

  const itemsByOrder = new Map<string, PurgeOrderItemRow[]>();
  for (const item of input.orderItems) {
    const bucket = itemsByOrder.get(item.orderId);
    if (bucket) bucket.push(item);
    else itemsByOrder.set(item.orderId, [item]);
  }

  // ── Products ─────────────────────────────────────────────────────────────
  const doomed = new Map<string, PurgeProductRow>();
  for (const slug of productSlugs) {
    const product = productBySlug.get(slug);
    if (!product) {
      notes.push(`product "${slug}" is not in this database — nothing to do for it`);
      continue;
    }
    if (keepProducts.has(slug)) kept.push({ label: `${slug} (${product.name})`, reason: "--keep" });
    else doomed.set(product.id, product);
  }
  for (const product of input.products) {
    if (!doomed.has(product.id) && !keepProducts.has(product.slug) && !productSlugs.includes(product.slug)) {
      kept.push({ label: `${product.slug} (${product.name})`, reason: "not on the demo list" });
    }
  }

  // ── Orders that sit entirely on the doomed products ─────────────────────
  const select = (doomedIds: ReadonlySet<string>) => {
    const variants = input.variants.filter((v) => doomedIds.has(v.productId));
    const variantIds = new Set(variants.map((v) => v.id));

    const orders: PurgeOrderRow[] = [];
    for (const order of input.orders) {
      const items = itemsByOrder.get(order.id) ?? [];
      // An order with no items claims no stock, so it is not something a purge
      // of *stock* has any business deciding about.
      if (items.length === 0) continue;
      if (!items.every((item) => variantIds.has(item.variantId))) continue;
      if (keepOrders.has(order.reference)) {
        blocked.push({ label: order.reference, reason: "--keep-order" });
        continue;
      }
      orders.push(order);
    }

    return { variants, orders };
  };

  let selection = select(new Set(doomed.keys()));
  for (;;) {
    const doomedOrderIds = new Set(selection.orders.map((o) => o.id));
    const saved = new Map<string, BlockedRow>();

    for (const item of input.orderItems) {
      if (doomedOrderIds.has(item.orderId)) continue;
      const variant = variantById.get(item.variantId);
      if (!variant || !doomed.has(variant.productId)) continue;
      const product = doomed.get(variant.productId) as PurgeProductRow;
      const order = orderById.get(item.orderId);
      saved.set(product.id, {
        label: `${product.slug} (${product.name})`,
        reason:
          `variant ${variant.id} is still claimed by order ${order?.reference ?? item.orderId},` +
          " which is not being removed",
      });
    }

    if (saved.size === 0) break;
    for (const [id, row] of saved) {
      doomed.delete(id);
      blocked.push(row);
    }
    selection = select(new Set(doomed.keys()));
  }

  const doomedOrderIds = new Set(selection.orders.map((o) => o.id));

  // ── Batches ─────────────────────────────────────────────────────────────
  const doomedBatches = new Map<string, PurgeBatchRow>();
  for (const slug of batchSlugs) {
    const batch = batchBySlug.get(slug);
    if (!batch) {
      notes.push(`batch "${slug}" is not in this database — nothing to do for it`);
      continue;
    }
    if (keepBatches.has(slug)) {
      kept.push({ label: `${slug} (${batch.name})`, reason: "--keep-batch" });
      continue;
    }
    doomedBatches.set(batch.id, batch);
  }

  // An order that stays inside a batch that goes: the batch cannot follow it,
  // because that order's batchId still points at it. Reported rather than
  // worked around — moving an order to another batch is an operator's call, and
  // the storefront would otherwise show a drop with no orders to fulfil.
  for (const [batchId, batch] of [...doomedBatches]) {
    const staying = input.orders.filter((o) => o.batchId === batchId && !doomedOrderIds.has(o.id));
    if (staying.length === 0) continue;
    doomedBatches.delete(batchId);
    blocked.push({
      label: `${batch.slug} (${batch.name})`,
      reason: `${staying.length} order(s) stay in it: ${staying.map((o) => o.reference).join(", ")}`,
    });
  }

  // ── What hangs off the deleted rows ─────────────────────────────────────
  const orderItems = input.orderItems.filter((item) => doomedOrderIds.has(item.orderId));
  const statusHistory = input.statusHistory.filter((row) => doomedOrderIds.has(row.orderId));

  // Audit rows: those describing a deleted order, those a throwaway probe
  // wrote, and those whose stored JSON names one of the deleted ids. The last
  // case is what keeps the admin Activity Log from announcing "product created"
  // for a product that no longer exists.
  const deletedIds = new Set<string>([
    ...doomed.keys(),
    ...selection.variants.map((v) => v.id),
    ...doomedBatches.keys(),
    ...doomedOrderIds,
  ]);
  const mentionsDeletedId = (row: PurgeAuditLogRow): boolean => {
    for (const value of [row.oldValue, row.newValue, row.metadata]) {
      if (value === null || value === undefined) continue;
      const text = typeof value === "string" ? value : JSON.stringify(value);
      if (!text) continue;
      for (const id of deletedIds) if (text.includes(id)) return true;
    }
    return false;
  };
  const auditLogs = input.auditLogs.filter(
    (row) =>
      (row.orderId !== null && doomedOrderIds.has(row.orderId)) ||
      row.actor.startsWith(TEST_ACTOR_PREFIX) ||
      mentionsDeletedId(row)
  );

  // Named so the dry run can show them: "34 of 35 audit rows go" invites the
  // question "which one stays?", and the answer is the part a person can check.
  const deletedAuditIds = new Set(auditLogs.map((row) => row.id));
  const keptAuditLogs: BlockedRow[] = input.auditLogs
    .filter((row) => !deletedAuditIds.has(row.id))
    .map((row) => ({
      label: `${row.createdAt.toISOString()}  ${row.action} by ${row.actor}`,
      reason: "nothing it describes is being removed",
    }));

  // ── Customers ───────────────────────────────────────────────────────────
  const ordersByCustomer = new Map<string, PurgeOrderRow[]>();
  for (const order of input.orders) {
    if (!order.customerId) continue;
    const bucket = ordersByCustomer.get(order.customerId);
    if (bucket) bucket.push(order);
    else ordersByCustomer.set(order.customerId, [order]);
  }

  const customers: PurgeCustomerRow[] = [];
  for (const customer of input.customers) {
    const handle = customer.instagramHandle.toLowerCase();
    if (keepHandles.has(handle)) {
      kept.push({ label: `@${handle}`, reason: "--keep-handle" });
      continue;
    }

    const theirOrders = ordersByCustomer.get(customer.id) ?? [];
    const surviving = theirOrders.filter((o) => !doomedOrderIds.has(o.id));

    if (theirOrders.length > 0 && surviving.length === 0) {
      customers.push(customer);
      continue;
    }
    if (theirOrders.length === 0) {
      const looksLikeAProbe = TEST_HANDLE_PREFIXES.some((prefix) => handle.startsWith(prefix));
      if (looksLikeAProbe || purgeHandles.has(handle)) {
        customers.push(customer);
      } else {
        notes.push(
          `customer @${handle} has no orders and is not a test handle — kept` +
            ` (use --purge-handle ${handle} to remove it)`
        );
      }
      continue;
    }
    kept.push({ label: `@${handle}`, reason: `${surviving.length} order(s) staying` });
  }

  const batchProducts = input.batchProducts.filter(
    (link) => doomedBatches.has(link.batchId) || doomed.has(link.productId)
  );
  const products = [...doomed.values()];
  const orphanedImages = products.flatMap((p) => [...p.images]);

  if (products.length === 0 && doomedBatches.size === 0) {
    notes.push("nothing on the demo list is present in this database");
  }

  return {
    delete: {
      products,
      variants: selection.variants,
      batches: [...doomedBatches.values()],
      batchProducts,
      orders: selection.orders,
      orderItems,
      statusHistory,
      auditLogs,
      customers,
    },
    blocked,
    kept,
    keptAuditLogs,
    orphanedImages,
    notes,
  };
}

export interface PurgePlan {
  delete: {
    products: PurgeProductRow[];

    variants: PurgeVariantRow[];
    batches: PurgeBatchRow[];
    batchProducts: PurgeBatchProductRow[];
    orders: PurgeOrderRow[];
    orderItems: PurgeOrderItemRow[];
    statusHistory: PurgeStatusHistoryRow[];
    auditLogs: PurgeAuditLogRow[];
    customers: PurgeCustomerRow[];
  };
  /** Rows that would have gone but were held back, with the reason. */
  blocked: BlockedRow[];
  /** Why each surviving product stays, for the dry run to print. */
  kept: BlockedRow[];
  /** Audit rows that stay, because nothing they describe is being removed. */
  keptAuditLogs: BlockedRow[];
  /** Image paths referenced by deleted products. The purge does not touch files. */
  orphanedImages: string[];
  /** The evidence for the selection, printed verbatim by the dry run. */
  notes: string[];
}

/** One number the purge would re-derive from the orders that survive it. */
export interface CapacityUpdate {
  kind: "variant" | "product";
  id: string;
  label: string;
  from: number | null;
  to: number | null;
}

/**
 * The numbers that have to be re-derived once rows are gone.
 *
 * `remainingCapacity` and `preorderReserved` are caches of the order items, and
 * a purge deletes order items — including items for stock that is *staying*,
 * whenever a test order happened to mix a demo product with a real one. The
 * surviving numbers are therefore recomputed rather than left for
 * `npm run db:check` to find later.
 *
 * Returns only what actually changes, so an unaffected database reports nothing
 * and a surprising change is visible in the output instead of being silent.
 */
export function planCapacityRecompute(input: {
  variants: readonly PurgeVariantRow[];
  products: readonly PurgeProductRow[];
  orders: readonly PurgeOrderRow[];
  orderItems: readonly PurgeOrderItemRow[];
}): CapacityUpdate[] {
  const holding = holdingOrderIds(input.orders);
  const items = input.orderItems.filter((item) => holding.has(item.orderId));

  const heldByVariant = heldQuantityByVariant(items);
  const heldByProduct = heldQuantityByProduct(input.variants, heldByVariant);

  const updates: CapacityUpdate[] = [];

  for (const variant of input.variants) {
    const held = heldByVariant.get(variant.id) ?? 0;
    const to = derivedRemainingCapacity(variant, held);
    if (to === variant.remainingCapacity) continue;
    updates.push({
      kind: "variant",
      id: variant.id,
      label: [variant.color, variant.size].filter(Boolean).join("/") || variant.id,
      from: variant.remainingCapacity,
      to,
    });
  }

  for (const product of input.products) {
    const to = derivedPreorderReserved(heldByProduct.get(product.id) ?? 0);
    if (to === product.preorderReserved) continue;
    updates.push({
      kind: "product",
      id: product.id,
      label: product.slug,
      from: product.preorderReserved,
      to,
    });
  }

  return updates;
}

/**
 * A value as a Postgres literal, for the restore script.
 *
 * Hand-rolled: the only consumer is a file a person may have to read at 2am, and
 * `pg` has no literal builder. Strings double their quotes, dates become ISO
 * timestamps, arrays become `ARRAY[...]` (or `'{}'` when empty, which is the
 * empty `text[]`), and objects become `'...'::jsonb` because every JSON column
 * in this schema is `jsonb`.
 */
export function pgLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (Array.isArray(value)) {
    return value.length === 0 ? "'{}'" : `ARRAY[${value.map(pgLiteral).join(", ")}]`;
  }
  // Prisma hands back a `Decimal` object for every `Decimal(10,2)` column, and a
  // Decimal *is* an object — so without this branch a price would be written as
  // `'"1299"'::jsonb`, which Postgres refuses to store in a numeric column. A
  // backup whose restore script cannot run is not a backup.
  if (isDecimalLike(value)) return value.toFixed();
  if (typeof value === "object") return `${pgLiteral(JSON.stringify(value))}::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * True for the `decimal.js` instance Prisma puts in a `Decimal` column.
 *
 * Duck-typed rather than imported, so this module stays free of the Prisma
 * runtime: `toFixed` together with `toNumber` is not a shape a plain JSON
 * object happens to have.
 */
function isDecimalLike(value: object): value is { toFixed: () => string } {
  const candidate = value as { toFixed?: unknown; toNumber?: unknown };
  return typeof candidate.toFixed === "function" && typeof candidate.toNumber === "function";
}

/**
 * `INSERT` statements that put rows back, one per row.
 *
 * Columns are passed in explicitly rather than read off the first row, so a
 * table whose rows disagree about their keys cannot quietly lose a column, and
 * so the restore file stays readable. No `ON CONFLICT`: restoring into a
 * database that still holds a row with the same primary key should fail loudly.
 */
export function insertStatements(
  table: string,
  columns: readonly string[],
  rows: readonly Record<string, unknown>[]
): string[] {
  const columnList = columns.map((column) => `"${column}"`).join(", ");
  return rows.map(
    (row) =>
      `INSERT INTO "${table}" (${columnList}) VALUES ` +
      `(${columns.map((column) => pgLiteral(row[column])).join(", ")});`
  );
}
