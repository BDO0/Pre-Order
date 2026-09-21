/**
 * The purge's I/O: read the rows, write the backup, delete, re-derive, verify.
 *
 * `purge-plan.ts` decides *what* goes; this file is the only part that touches a
 * database or a disk, and it is deliberately plain — two reads, one transaction,
 * one recomputation, one verification. The transaction is the only place that
 * writes anything an operator did not type, and it commits whole or not at all.
 *
 * Imported by `scripts/purge-demo-data.ts` (the CLI) and by the integration test
 * in `tests/purge-demo-data.test.ts`, which is why it takes a client rather than
 * creating one: the test hands it a throwaway database and asserts on the report.
 */
import type { PrismaClient } from "@prisma/client";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { auditCapacity, holdingOrderIds, type CapacityFinding } from "./capacity-audit";
import {
  insertStatements,
  planCapacityRecompute,
  planPurge,
  type CapacityUpdate,
  type PurgeInput,
  type PurgeOptions,
  type PurgeOrderItemRow,
  type PurgeOrderRow,
  type PurgePlan,
  type PurgeProductRow,
  type PurgeVariantRow,
} from "./purge-plan";

/**
 * The client surface this module needs, so the test can pass a client built on a
 * different connection string without pretending it is the app's.
 */
export type PurgeDb = Pick<
  PrismaClient,
  | "product"
  | "productVariant"
  | "batch"
  | "batchProduct"
  | "order"
  | "orderItem"
  | "orderStatusHistory"
  | "auditLog"
  | "customer"
  | "orderCounter"
  | "$transaction"
>;

export interface DatabaseIdentity {
  host: string;
  database: string;
  /** The Supabase project ref, when the connection string names one. */
  projectRef: string | null;
  /** What `--confirm` has to say: the project ref, or the host without one. */
  confirmToken: string;
}

/**
 * Which database a connection string points at, in the terms an operator says
 * out loud.
 *
 * The token is derived rather than configured, and it is printed by the dry run,
 * so a confirmation cannot be typed from memory: `--confirm` has to repeat
 * something this run produced. Supabase puts the project ref in the *user*
 * (`postgres.<ref>`) behind the pooler and in the *host* (`db.<ref>.supabase.co`)
 * on a direct connection; both are accepted, and anything else — a container, a
 * laptop — falls back to its hostname.
 */
export function databaseIdentity(connectionString: string): DatabaseIdentity {
  const url = new URL(connectionString);
  const host = url.hostname;
  const user = decodeURIComponent(url.username);

  const fromUser = /^postgres\.([a-z0-9]+)$/i.exec(user)?.[1] ?? null;
  const fromHost = /^db\.([a-z0-9]+)\.supabase\.(co|com|net)$/i.exec(host)?.[1] ?? null;
  const projectRef = fromHost ?? fromUser;

  return {
    host,
    database: url.pathname.replace(/^\//, "") || "postgres",
    projectRef,
    confirmToken: projectRef ?? host,
  };
}

/**
 * The dry run, as lines.
 *
 * Every sentence here is evidence rather than decoration: the slug, what kind
 * of row it is, and the count that made it a candidate. A person who cannot see
 * why a row was chosen cannot tell a correct purge from a catastrophic one, so
 * the plan is printed rather than summarised.
 */
export function describePlan(
  plan: PurgePlan,
  identity: DatabaseIdentity,
  applied: boolean
): string[] {
  const lines: string[] = [];
  const { delete: doomed } = plan;

  lines.push(`target     ${identity.host}/${identity.database}` +
    (identity.projectRef ? `  (project ${identity.projectRef})` : ""));
  lines.push(`mode       ${applied ? "APPLY (rows will be deleted)" : "dry run (nothing is written)"}`);
  lines.push("");

  lines.push(`products to delete (${doomed.products.length})`);
  for (const product of doomed.products) {
    const variants = doomed.variants.filter((v) => v.productId === product.id).length;
    const items = doomed.orderItems.filter((item) =>
      doomed.variants.some((v) => v.id === item.variantId && v.productId === product.id)
    ).length;
    lines.push(
      `  - ${product.slug}  "${product.name}"  ${product.preorderStatus}` +
        `  ${variants} variant(s)  ${items} item(s) in deleted orders`
    );
  }

  const links = doomed.batchProducts.length;
  const history = doomed.statusHistory.length;
  const customers = doomed.customers.map((c) => `@${c.instagramHandle}`).join(", ");
  lines.push("");
  lines.push(`also to delete`);
  lines.push(`  variants            ${doomed.variants.length}`);
  lines.push(`  batches             ${doomed.batches.map((b) => b.slug).join(", ") || "-"}`);
  lines.push(`  batch_products      ${links}`);
  lines.push(`  orders              ${doomed.orders.map((o) => `${o.reference} [${o.status}]`).join(", ") || "-"}`);
  lines.push(`  order_items         ${doomed.orderItems.length}`);
  lines.push(`  ${"order_status_history".padEnd(20)} ${history}`);
  lines.push(`  audit_logs          ${doomed.auditLogs.length}`);
  lines.push(`  customers           ${doomed.customers.length}${customers ? `  (${customers})` : ""}`);

  if (plan.blocked.length > 0) {
    lines.push("");
    lines.push(`held back (${plan.blocked.length})`);
    for (const row of plan.blocked) lines.push(`  ! ${row.label} — ${row.reason}`);
  }

  if (plan.kept.length > 0) {
    lines.push("");
    lines.push(`kept (${plan.kept.length})`);
    for (const row of plan.kept) lines.push(`  . ${row.label} — ${row.reason}`);
  }

  if (plan.keptAuditLogs.length > 0) {
    lines.push("");
    lines.push(`audit rows that stay (${plan.keptAuditLogs.length})`);
    for (const row of plan.keptAuditLogs) lines.push(`  . ${row.label}`);
  }

  if (plan.orphanedImages.length > 0) {
    lines.push("");
    lines.push(`imagery referenced by the deleted products (files are NOT removed)`);
    for (const image of plan.orphanedImages) lines.push(`  ~ ${image}`);
  }

  if (plan.notes.length > 0) {
    lines.push("");
    for (const note of plan.notes) lines.push(`note: ${note}`);
  }

  return lines;
}

/**
 * The rows the plan and the capacity recomputation are both derived from.
 *
 * One set of `select`s, used twice, so a plan built from these rows and a
 * recomputation built from them cannot be talking about different columns.
 */
export async function readCapacityState(db: PurgeDb): Promise<{
  variants: PurgeVariantRow[];
  products: PurgeProductRow[];
  orders: PurgeOrderRow[];
  orderItems: PurgeOrderItemRow[];
}> {
  const [products, variants, orders, orderItems] = await Promise.all([
    db.product.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        active: true,
        preorderStatus: true,
        images: true,
        preorderLimit: true,
        preorderReserved: true,
        createdAt: true,
      },
    }),
    db.productVariant.findMany({
      select: {
        id: true,
        productId: true,
        size: true,
        color: true,
        capacity: true,
        remainingCapacity: true,
      },
    }),
    db.order.findMany({
      select: {
        id: true,
        reference: true,
        status: true,
        batchId: true,
        customerId: true,
        createdAt: true,
      },
    }),
    db.orderItem.findMany({
      select: { id: true, orderId: true, variantId: true, quantity: true },
    }),
  ]);

  return { products, variants, orders, orderItems };
}

/** Everything the decision needs, read once. */
export async function readPurgeInput(db: PurgeDb): Promise<PurgeInput> {
  const capacity = await readCapacityState(db);
  const [batches, batchProducts, statusHistory, auditLogs, customers] = await Promise.all([
    db.batch.findMany({ select: { id: true, slug: true, name: true, status: true } }),
    db.batchProduct.findMany({ select: { batchId: true, productId: true } }),
    db.orderStatusHistory.findMany({ select: { id: true, orderId: true } }),
    db.auditLog.findMany({
      select: {
        id: true,
        orderId: true,
        actor: true,
        action: true,
        createdAt: true,
        oldValue: true,
        newValue: true,
        metadata: true,
      },
    }),
    db.customer.findMany({
      select: { id: true, instagramHandle: true, fullName: true, createdAt: true },
    }),
  ]);

  return { ...capacity, batches, batchProducts, statusHistory, auditLogs, customers };
}

/**
 * Every capacity rule, checked against the database as it is *now*.
 *
 * This is the same function `npm run db:check` prints, so a purge cannot sign
 * off on a database that the audit would reject — and there is no second
 * implementation to disagree with it.
 */
export async function verifyCapacity(db: PurgeDb): Promise<CapacityFinding[]> {
  const { variants, products, orders, orderItems } = await readCapacityState(db);

  const emptyOrders = await db.order.findMany({
    where: { items: { none: {} } },
    select: { reference: true, status: true },
    take: 6,
  });
  const holding = holdingOrderIds(orders);

  return auditCapacity({
    variants,
    products,
    items: orderItems
      .filter((item) => holding.has(item.orderId))
      .map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
    emptyOrders,
  });
}

/** The reference counters, which a purge must leave exactly as it found them. */
export async function readCounters(db: PurgeDb): Promise<{ day: string; lastValue: number }[]> {
  const rows = await db.orderCounter.findMany({
    select: { day: true, lastValue: true },
    orderBy: { day: "asc" },
  });
  return rows.map((row) => ({ day: row.day.toISOString().slice(0, 10), lastValue: row.lastValue }));
}

/**
 * Every column of every row that is about to be deleted, re-read by id.
 *
 * Re-read rather than reused from the plan: the plan carries the handful of
 * columns the decision needed, and a backup that can only restore the columns
 * somebody thought to select is not a backup. A `findMany` with no `select`
 * returns the whole row.
 */
export async function readBackupRows(
  db: PurgeDb,
  plan: PurgePlan
): Promise<Record<string, Record<string, unknown>[]>> {
  const productIds = plan.delete.products.map((row) => row.id);
  const variantIds = plan.delete.variants.map((row) => row.id);
  const batchIds = plan.delete.batches.map((row) => row.id);
  const orderIds = plan.delete.orders.map((row) => row.id);
  const customerIds = plan.delete.customers.map((row) => row.id);
  const auditIds = plan.delete.auditLogs.map((row) => row.id);

  const [
    products,
    variants,
    batches,
    batchProducts,
    orders,
    orderItems,
    statusHistory,
    auditLogs,
    customers,
  ] = await Promise.all([
    db.product.findMany({ where: { id: { in: productIds } } }),
    db.productVariant.findMany({ where: { id: { in: variantIds } } }),
    db.batch.findMany({ where: { id: { in: batchIds } } }),
    db.batchProduct.findMany({
      where: { OR: [{ batchId: { in: batchIds } }, { productId: { in: productIds } }] },
    }),
    db.order.findMany({ where: { id: { in: orderIds } } }),
    db.orderItem.findMany({ where: { orderId: { in: orderIds } } }),
    db.orderStatusHistory.findMany({ where: { orderId: { in: orderIds } } }),
    db.auditLog.findMany({ where: { id: { in: auditIds } } }),
    db.customer.findMany({ where: { id: { in: customerIds } } }),
  ]);

  // Prisma's row types are objects of scalars, arrays and JSON values; the
  // backup serialises them as such instead of restating every column of every
  // table, which would be a second copy of the schema to keep in step.
  const asRows = (rows: readonly unknown[]): Record<string, unknown>[] =>
    rows as unknown as Record<string, unknown>[];

  return {
    products: asRows(products),
    product_variants: asRows(variants),
    batches: asRows(batches),
    batch_products: asRows(batchProducts),
    orders: asRows(orders),
    order_items: asRows(orderItems),
    order_status_history: asRows(statusHistory),
    audit_logs: asRows(auditLogs),
    customers: asRows(customers),
  };
}

export interface BackupResult {
  dir: string;
  files: string[];
}

/**
 * Parent before child, so `restore.sql` can be run top to bottom.
 *
 * The reverse of the delete order, which is the whole reason it is written down
 * once here rather than derived from the manifest at read time.
 */
const RESTORE_ORDER: readonly string[] = [
  "products",
  "product_variants",
  "batches",
  "batch_products",
  "customers",
  "orders",
  "order_items",
  "order_status_history",
  "audit_logs",
];

/**
 * Writes the rows that are about to be deleted to `directory`.
 *
 * The caller does not delete anything until this resolves: a backup that failed
 * halfway would otherwise be discovered at the moment it is needed, which is
 * the only moment it matters.
 */
export async function writeBackup(
  directory: string,
  tables: Record<string, Record<string, unknown>[]>,
  manifest: Record<string, unknown>
): Promise<BackupResult> {
  await mkdir(directory, { recursive: true });
  const files: string[] = [];

  for (const [table, rows] of Object.entries(tables)) {
    const name = `${table}.json`;
    await writeFile(join(directory, name), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
    files.push(name);
  }

  const restore: string[] = [
    "-- Rows removed by scripts/purge-demo-data.ts, written back as INSERTs.",
    "-- Read manifest.json first: it names the database these came from.",
    "-- Check the row counts the INSERTs report against the manifest.",
    "",
  ];
  for (const table of RESTORE_ORDER) {
    const rows = tables[table] ?? [];
    if (rows.length === 0) continue;
    restore.push(`-- ${table}: ${rows.length} row(s)`);
    restore.push(...insertStatements(table, Object.keys(rows[0]), rows));
    restore.push("");
  }
  await writeFile(join(directory, "restore.sql"), `${restore.join("\n")}\n`, "utf8");
  files.push("restore.sql");

  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  files.push("manifest.json");

  return { dir: directory, files };
}

/**
 * Removes the planned rows in one transaction, children before parents.
 *
 * Every step asserts the row count it was handed. A plan built from a snapshot
 * that has since changed would delete too few rows, and rather than carrying on
 * this throws and the whole transaction rolls back. That is the difference
 * between a purge that leaves half an order behind and one that leaves nothing.
 *
 * Prisma maps these relations without `ON DELETE CASCADE`, so the database
 * itself refuses to remove a parent while a child still points at it — the
 * order below is what keeps every step legal.
 */
async function deleteRows(db: PurgeDb, plan: PurgePlan): Promise<Record<string, number>> {
  const { delete: doomed } = plan;
  const ids = (rows: readonly { id: string }[]): string[] => rows.map((row) => row.id);

  return db.$transaction(
    async (tx) => {
      const step = async (
        table: string,
        expected: number,
        run: () => Promise<{ count: number }>
      ): Promise<number> => {
        if (expected === 0) return 0;
        const result = await run();
        if (result.count !== expected) {
          throw new Error(
            `${table}: the plan expected ${expected} row(s) but ${result.count} matched,` +
              " so nothing was deleted and the transaction was rolled back"
          );
        }
        return result.count;
      };

      const deleted: Record<string, number> = {};

      deleted.audit_logs = await step("audit_logs", doomed.auditLogs.length, () =>
        tx.auditLog.deleteMany({ where: { id: { in: ids(doomed.auditLogs) } } })
      );
      deleted.order_status_history = await step(
        "order_status_history",
        doomed.statusHistory.length,
        () => tx.orderStatusHistory.deleteMany({ where: { id: { in: ids(doomed.statusHistory) } } })
      );
      deleted.order_items = await step("order_items", doomed.orderItems.length, () =>
        tx.orderItem.deleteMany({ where: { id: { in: ids(doomed.orderItems) } } })
      );
      deleted.orders = await step("orders", doomed.orders.length, () =>
        tx.order.deleteMany({ where: { id: { in: ids(doomed.orders) } } })
      );
      deleted.customers = await step("customers", doomed.customers.length, () =>
        tx.customer.deleteMany({ where: { id: { in: ids(doomed.customers) } } })
      );
      deleted.batch_products = await step("batch_products", doomed.batchProducts.length, () =>
        tx.batchProduct.deleteMany({
          where: {
            OR: [
              { batchId: { in: doomed.batchProducts.map((row) => row.batchId) } },
              { productId: { in: doomed.batchProducts.map((row) => row.productId) } },
            ],
          },
        })
      );
      deleted.product_variants = await step("product_variants", doomed.variants.length, () =>
        tx.productVariant.deleteMany({ where: { id: { in: ids(doomed.variants) } } })
      );
      deleted.products = await step("products", doomed.products.length, () =>
        tx.product.deleteMany({ where: { id: { in: ids(doomed.products) } } })
      );
      deleted.batches = await step("batches", doomed.batches.length, () =>
        tx.batch.deleteMany({ where: { id: { in: ids(doomed.batches) } } })
      );

      return deleted;
    },
    { timeout: 60_000, maxWait: 15_000 }
  );
}

export interface PurgeRunOptions extends PurgeOptions {
  /** Delete for real. False reads and plans only, and writes nothing at all. */
  apply: boolean;
  /** Base directory for the timestamped backup folder. */
  backupDir: string;
  log?: (line: string) => void;
}

export interface PurgeReport {
  identity: DatabaseIdentity;
  plan: PurgePlan;
  applied: boolean;
  backup: BackupResult | null;
  /** Rows deleted, per table, exactly as the database reported them. */
  deleted: Record<string, number>;
  capacityUpdates: CapacityUpdate[];
  findings: CapacityFinding[];
  countersUnchanged: boolean;
}

/**
 * Plans, backs up, deletes, re-derives and verifies — the whole purge.
 *
 * The order of these five steps is the design. The plan is read from the
 * database rather than passed in, so the rows deleted are the rows that are
 * there *now*; the backup is written and awaited before the first delete, and a
 * thrown error there means nothing was removed; the deletes are one transaction
 * that asserts its own row counts; the capacity numbers are re-derived from what
 * survived; and the result is checked with the same rules `npm run db:check`
 * prints. A dry run takes the first step only and writes nothing at all — not
 * even a backup directory.
 */
export async function runPurge(
  db: PurgeDb,
  connectionString: string,
  options: PurgeRunOptions
): Promise<PurgeReport> {
  const log = options.log ?? ((): void => {});
  const identity = databaseIdentity(connectionString);

  const input = await readPurgeInput(db);
  const plan = planPurge(input, options);

  const doomedRows =
    plan.delete.products.length +
    plan.delete.batches.length +
    plan.delete.orders.length +
    plan.delete.customers.length +
    plan.delete.auditLogs.length;

  if (!options.apply || doomedRows === 0) {
    if (doomedRows === 0) log("nothing on the demo list is present; the database is untouched");
    return {
      identity,
      plan,
      applied: false,
      backup: null,
      deleted: {},
      capacityUpdates: [],
      findings: await verifyCapacity(db),
      countersUnchanged: true,
    };
  }

  // ── 1. The backup, awaited before the first delete ──────────────────────
  const takenAt = new Date().toISOString();
  const tables = await readBackupRows(db, plan);
  const backup = await writeBackup(
    join(options.backupDir, takenAt.replace(/[:.]/g, "-")),
    tables,
    {
      takenAt,
      tool: "scripts/purge-demo-data.ts",
      database: {
        host: identity.host,
        database: identity.database,
        projectRef: identity.projectRef,
      },
      rows: Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])),
      deleting: {
        products: plan.delete.products.map((row) => row.slug),
        batches: plan.delete.batches.map((row) => row.slug),
        orders: plan.delete.orders.map((row) => row.reference),
        customers: plan.delete.customers.map((row) => row.instagramHandle),
      },
      blocked: plan.blocked,
      kept: plan.kept,
      notes: plan.notes,
    }
  );
  log(`backup written: ${backup.dir} (${backup.files.length} file(s))`);

  // ── 2. The reference counters, for afterwards ──────────────────────────
  // Deleting orders must not move a counter: the next checkout is handed
  // whatever comes after the last one issued, and a counter that went backwards
  // would hand out a reference that is already on a customer's screen.
  const countersBefore = await readCounters(db);

  // ── 3. Delete, all of it or none of it ──────────────────────────────────
  const deleted = await deleteRows(db, plan);
  const deletedTotal = Object.values(deleted).reduce((sum, count) => sum + count, 0);
  log(`deleted ${deletedTotal} row(s) in one transaction`);

  // ── 4. Re-derive the stock those order items were holding ───────────────
  const survivors = await readCapacityState(db);
  const capacityUpdates = planCapacityRecompute(survivors);
  if (capacityUpdates.length > 0) {
    await db.$transaction(
      async (tx) => {
        for (const update of capacityUpdates) {
          if (update.kind === "variant") {
            await tx.productVariant.update({
              where: { id: update.id },
              data: { remainingCapacity: update.to },
            });
          } else {
            await tx.product.update({
              where: { id: update.id },
              data: { preorderReserved: update.to ?? 0 },
            });
          }
        }
      },
      { timeout: 60_000, maxWait: 15_000 }
    );
    log(`re-derived ${capacityUpdates.length} capacity number(s)`);
  }

  // ── 5. Hold the result to the rules db:check prints ─────────────────────
  const findings = await verifyCapacity(db);
  const countersAfter = await readCounters(db);
  const countersUnchanged = JSON.stringify(countersBefore) === JSON.stringify(countersAfter);

  return {
    identity,
    plan,
    applied: true,
    backup,
    deleted,
    capacityUpdates,
    findings,
    countersUnchanged,
  };
}
