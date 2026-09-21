/**
 * Read-only integrity audit for the pre-order database.
 *
 *   npm run db:check
 *
 * This script never writes. It prints row counts, checks the capacity
 * invariants the atomic-checkout work is responsible for, and verifies that
 * stored capacity still agrees with the live order items. Rows written before
 * that work landed can be legitimately inconsistent, so it reports instead of
 * repairing: an automatic "fix" would silently bake a wrong number in.
 *
 * Exit code 0 = every invariant holds, 1 = something is broken, so it can be
 * wired into a deploy gate later.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPoolConfig } from "../src/lib/pg-ssl";
import { CAPACITY_RELEASING_STATUSES } from "../src/lib/order-state-machine";
import { auditCapacity } from "../src/lib/capacity-audit";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and provide a Postgres connection string."
  );
}

// Same pool and TLS settings as the app and the seed (src/lib/pg-ssl), so a
// finding here can never be an artefact of different connection options.
const databaseUrl: string = connectionString;
const pool = new Pool(createPoolConfig(databaseUrl));
const prisma = new PrismaClient({ adapter: new PrismaPg(pool), log: ["error"] });

const problems: string[] = [];

function heading(title: string): void {
  console.log(`\n${title}\n${"-".repeat(title.length)}`);
}

/** Records a failure without throwing so one run reports every problem. */
function check(label: string, ok: boolean, detail?: string): void {
  console.log(ok ? `  PASS  ${label}` : `  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) problems.push(label);
}

function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const schema = parsed.searchParams.get("schema");
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}${schema ? `?schema=${schema}` : ""}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

/**
 * Today's day key in local time, matching how `order-number.ts` stamps its
 * references. Local rather than UTC on purpose: the counter is keyed by the same
 * calendar day the prefix shows, and the two must never disagree.
 */
function localDay(now: Date): { iso: string; prefix: string } {
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  return { iso: `${year}-${month}-${day}`, prefix: `PO-${year}${month}${day}-` };
}

async function main(): Promise<void> {
  console.log("Pre-order database audit (read-only)");
  console.log(`Target: ${describeTarget(databaseUrl)}`);
  console.log(`Capacity released by: ${CAPACITY_RELEASING_STATUSES.join(", ")}`);

  // ── Rows ────────────────────────────────────────────────────────────────
  const [
    admins,
    products,
    variants,
    batchProducts,
    customers,
    batches,
    orders,
    orderItems,
    statusHistory,
    auditLogs,
  ] = await Promise.all([
    prisma.admin.count(),
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.batchProduct.count(),
    prisma.customer.count(),
    prisma.batch.count(),
    prisma.order.count(),
    prisma.orderItem.count(),
    prisma.orderStatusHistory.count(),
    prisma.auditLog.count(),
  ]);

  heading("Rows");
  const counts: Record<string, number> = {
    admins,
    products,
    product_variants: variants,
    batch_products: batchProducts,
    customers,
    batches,
    orders,
    order_items: orderItems,
    order_status_history: statusHistory,
    audit_logs: auditLogs,
  };
  for (const [name, count] of Object.entries(counts)) {
    console.log(`  ${name.padEnd(22)} ${String(count).padStart(6)}`);
  }

  // ── Orders by status ────────────────────────────────────────────────────
  heading("Orders by status");
  const byStatus = await prisma.order.groupBy({ by: ["status"], _count: { _all: true } });
  if (byStatus.length === 0) {
    console.log("  (no orders yet)");
  } else {
    for (const row of byStatus.sort((a, b) => a.status.localeCompare(b.status))) {
      console.log(`  ${row.status.padEnd(20)} ${String(row._count._all).padStart(5)}`);
    }
  }

  // ── Capacity invariants ─────────────────────────────────────────────────
  heading("Capacity invariants");

  // These tables are small by design, so the whole set is fetched and filtered
  // in JS: Prisma cannot compare two columns of the same row in `where`.
  const variantRows = await prisma.productVariant.findMany({
    select: {
      id: true,
      productId: true,
      size: true,
      color: true,
      capacity: true,
      remainingCapacity: true,
    },
  });
  const productRows = await prisma.product.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      active: true,
      preorderStatus: true,
      preorderLimit: true,
      preorderReserved: true,
    },
  });

  // Order items that still hold stock, fetched once: the reconciliation rules
  // compare what each row *remembers* holding with what the orders say is held.
  // An order that was voided -- CANCELLED or REJECTED -- handed its stock back,
  // so it is excluded here and nowhere else.
  const held = await prisma.orderItem.groupBy({
    by: ["variantId"],
    where: { order: { status: { notIn: CAPACITY_RELEASING_STATUSES } } },
    _sum: { quantity: true },
  });
  const emptyOrders = await prisma.order.findMany({
    where: { items: { none: {} } },
    select: { reference: true, status: true },
    take: 6,
  });

  // The rules themselves are shared with `npm run demo:purge`
  // (src/lib/capacity-audit.ts), because a purge has to hold the database to
  // the same standard after deleting rows. One finding per rule, always, so
  // eight lines below means eight rules ran rather than that the rest were
  // quiet.
  for (const finding of auditCapacity({
    variants: variantRows,
    products: productRows,
    items: held.map((row) => ({ variantId: row.variantId, quantity: row._sum.quantity ?? 0 })),
    emptyOrders,
  })) {
    check(finding.rule, finding.pass, finding.detail);
  }

  // ── Stored capacity vs live order items ─────────────────────────────────
  // Capacity held by an order is live until that order is voided, which is why
  // the two reconciliation rules above count only the orders that still hold
  // their stock.

  // ── Order reference counter ─────────────────────────────────────────────
  // References are handed out by an atomic upsert on `order_counters`. If that
  // row ever falls behind the references already stored, the next checkout can
  // be handed a number that is already taken.
  heading("Order reference counter");
  const { iso: todayIso, prefix: todayPrefix } = localDay(new Date());

  const [counterTable] = await prisma.$queryRaw<Array<{ present: boolean }>>`
    SELECT to_regclass('public.order_counters') IS NOT NULL AS present
  `;

  if (!counterTable?.present) {
    console.log("  SKIP  order_counters is missing; run `npm run db:deploy`.");
  } else {
    const counterRows = await prisma.$queryRaw<Array<{ last_value: number }>>`
      SELECT last_value FROM order_counters WHERE day = ${todayIso}::date
    `;
    const issuedToday = await prisma.order.findMany({
      where: { reference: { startsWith: todayPrefix } },
      select: { reference: true },
    });
    const highestIssued = issuedToday.reduce((max, order) => {
      const sequence = Number.parseInt(order.reference.slice(todayPrefix.length), 10);
      return Number.isNaN(sequence) ? max : Math.max(max, sequence);
    }, 0);

    const counter = counterRows[0]?.last_value ?? 0;
    console.log(
      `  Today (${todayIso}): counter at ${counter}, highest issued reference ${highestIssued}.`
    );
    check(
      "counter sits at or above the highest issued reference",
      counter >= highestIssued,
      `counter ${counter} vs highest issued ${highestIssued}`
    );
  }

  heading("Catalogue");
  const batchRows = await prisma.batch.findMany({
    select: { id: true, slug: true, status: true, startAt: true, endAt: true },
    orderBy: { createdAt: "asc" },
  });
  const links = await prisma.batchProduct.findMany({
    select: { batchId: true, productId: true },
  });

  if (batchRows.length === 0) console.log("  (no batches)");
  for (const b of batchRows) {
    const linked = links.filter((l) => l.batchId === b.id).length;
    const from = b.startAt ? b.startAt.toISOString().slice(0, 10) : "open";
    const to = b.endAt ? b.endAt.toISOString().slice(0, 10) : "no end";
    console.log(`  ${b.slug} [${b.status}] ${linked} product(s), ${from} -> ${to}`);
  }

  if (productRows.length === 0) console.log("  (no products)");
  for (const p of productRows) {
    const owned = variantRows.filter((v) => v.productId === p.id);
    const limited = owned.filter((v) => v.capacity !== null);
    const remaining = limited.reduce((sum, v) => sum + (v.remainingCapacity ?? 0), 0);
    const capacity = limited.reduce((sum, v) => sum + (v.capacity ?? 0), 0);
    const limit = p.preorderLimit === null ? "no limit" : `limit ${p.preorderLimit}`;
    const unlimited = owned.length - limited.length;
    // "0/0" is ambiguous: it can mean "no stock left" or "no variant has a
    // capacity at all". Unlimited variants are bounded only by the product
    // preorderLimit, so that case is named explicitly.
    const stock = limited.length === 0 ? "unlimited capacity" : `${remaining}/${capacity} left`;
    const extra = unlimited > 0 && limited.length > 0 ? ` (+${unlimited} unlimited)` : "";
    console.log(
      `  ${p.slug} [${p.preorderStatus}] ${p.active ? "active" : "inactive"} ` +
        `reserved ${p.preorderReserved} (${limit}), ${owned.length} variant(s), ` +
        `${stock}${extra}`
    );
  }

  // ── Notes ───────────────────────────────────────────────────────────────
  heading("Notes");
  let notes = 0;

  if (products === 0) {
    console.log(
      "  - Catalogue is empty. Add the real products in Admin → Products, then put them" +
        " in a drop in Admin → Batches: the storefront lists what an open batch holds."
    );
    notes += 1;
  }

  // Orders placed before the Instagram handle became the identity may have no
  // handle in their snapshot. They are still readable, but the public fallback
  // lookup (reference + handle) cannot find them — only their own token can.
  // Raw SQL: Prisma's JSON filter type has no way to express "this key is absent".
  const missingHandleRows = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM "orders"
    WHERE "customerSnapshot" ->> 'instagramHandle' IS NULL
  `;
  const ordersWithoutHandle = missingHandleRows[0]?.count ?? 0;
  if (ordersWithoutHandle > 0) {
    console.log(
      `  - ${ordersWithoutHandle} order(s) carry no Instagram handle in their snapshot;` +
        " the reference + handle lookup cannot find them (their token link still works)."
    );
    notes += 1;
  }



  if (!process.env.TEST_DATABASE_URL) {
    console.log(
      "  - TEST_DATABASE_URL is not set, so the integration tests in tests/ report as skipped." +
        " `npm run test:db` runs them against a throwaway Postgres instead."
    );
    notes += 1;
  }

  if (/supabase\.co$/.test(new URL(databaseUrl).hostname)) {
    console.log(
      "  - Supabase free tier pauses after ~7 idle days; use the pooler host for serverless deploys."
    );
    notes += 1;
  }

  if (notes === 0) console.log("  (none)");

  // ── Summary ─────────────────────────────────────────────────────────────
  heading("Summary");
  if (problems.length === 0) {
    console.log("  All invariants hold.");
  } else {
    console.log(`  ${problems.length} problem(s):`);
    for (const problem of problems) console.log(`    - ${problem}`);
  }
  process.exitCode = problems.length === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error("\nAudit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
