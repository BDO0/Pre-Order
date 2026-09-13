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

function list(values: string[], limit = 5): string {
  const shown = values.slice(0, limit).join(", ");
  return values.length > limit ? `${shown}, +${values.length - limit} more` : shown;
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
    campaigns,
    products,
    variants,
    campaignProducts,
    customers,
    paymentMethods,
    orders,
    orderItems,
    paymentProofs,
    statusHistory,
    auditLogs,
  ] = await Promise.all([
    prisma.admin.count(),
    prisma.campaign.count(),
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.campaignProduct.count(),
    prisma.customer.count(),
    prisma.paymentMethod.count(),
    prisma.order.count(),
    prisma.orderItem.count(),
    prisma.paymentProof.count(),
    prisma.orderStatusHistory.count(),
    prisma.auditLog.count(),
  ]);

  heading("Rows");
  const counts: Record<string, number> = {
    admins,
    campaigns,
    products,
    product_variants: variants,
    campaign_products: campaignProducts,
    customers,
    payment_methods: paymentMethods,
    orders,
    order_items: orderItems,
    payment_proofs: paymentProofs,
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

  const label = (v: { id: string; size: string | null; color: string | null }) =>
    `${v.id} (${[v.color, v.size].filter(Boolean).join("/") || "no size"})`;

  const negative = variantRows.filter(
    (v) => v.remainingCapacity !== null && v.remainingCapacity < 0
  );
  check(
    "no variant has a negative remainingCapacity",
    negative.length === 0,
    list(negative.map(label))
  );

  const overCapacity = variantRows.filter(
    (v) => v.capacity !== null && v.remainingCapacity !== null && v.remainingCapacity > v.capacity
  );
  check(
    "no variant holds more remaining than its capacity",
    overCapacity.length === 0,
    list(overCapacity.map((v) => `${label(v)}: ${v.remainingCapacity}/${v.capacity}`))
  );

  const halfNull = variantRows.filter(
    (v) => (v.capacity === null) !== (v.remainingCapacity === null)
  );
  check(
    "capacity and remainingCapacity are both set or both NULL",
    halfNull.length === 0,
    list(halfNull.map(label))
  );

  const negativeReserved = productRows.filter((p) => p.preorderReserved < 0);
  check(
    "no product has a negative preorderReserved",
    negativeReserved.length === 0,
    list(negativeReserved.map((p) => p.slug))
  );

  const overLimit = productRows.filter(
    (p) => p.preorderLimit !== null && p.preorderReserved > p.preorderLimit
  );
  check(
    "no product has reserved more than its preorderLimit",
    overLimit.length === 0,
    list(overLimit.map((p) => `${p.slug}: ${p.preorderReserved}/${p.preorderLimit}`))
  );

  const emptyOrders = await prisma.order.findMany({
    where: { items: { none: {} } },
    select: { reference: true, status: true },
    take: 6,
  });
  check(
    "every order has at least one item",
    emptyOrders.length === 0,
    list(emptyOrders.map((o) => `${o.reference} (${o.status})`))
  );

  // ── Stored capacity vs live order items ─────────────────────────────────
  heading("Storage reconciliation");
  console.log("  Capacity held by an order is live until that order is voided.");

  const held = await prisma.orderItem.groupBy({
    by: ["variantId"],
    where: { order: { status: { notIn: CAPACITY_RELEASING_STATUSES } } },
    _sum: { quantity: true },
  });
  const heldByVariant = new Map(held.map((row) => [row.variantId, row._sum.quantity ?? 0]));

  const variantMismatch: string[] = [];
  for (const v of variantRows) {
    // Unlimited variants hold no per-variant capacity; only the product limit
    // applies, which is reconciled below.
    if (v.capacity === null || v.remainingCapacity === null) continue;
    const stored = v.capacity - v.remainingCapacity;
    const live = heldByVariant.get(v.id) ?? 0;
    if (stored !== live) variantMismatch.push(`${label(v)}: stored ${stored} vs live ${live}`);
  }
  check(
    "variant capacity consumed matches live order items",
    variantMismatch.length === 0,
    list(variantMismatch)
  );

  const productOfVariant = new Map(variantRows.map((v) => [v.id, v.productId]));
  const liveByProduct = new Map<string, number>();
  for (const [variantId, quantity] of heldByVariant) {
    const productId = productOfVariant.get(variantId);
    if (productId) liveByProduct.set(productId, (liveByProduct.get(productId) ?? 0) + quantity);
  }

  const productMismatch: string[] = [];
  for (const p of productRows) {
    const live = liveByProduct.get(p.id) ?? 0;
    if (p.preorderReserved !== live) {
      productMismatch.push(`${p.slug}: stored ${p.preorderReserved} vs live ${live}`);
    }
  }
  check(
    "product preorderReserved matches live order items",
    productMismatch.length === 0,
    list(productMismatch)
  );

  // ── Catalogue ───────────────────────────────────────────────────────────
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
  const campaignRows = await prisma.campaign.findMany({
    select: { id: true, slug: true, status: true, startAt: true, endAt: true },
    orderBy: { createdAt: "asc" },
  });
  const links = await prisma.campaignProduct.findMany({
    select: { campaignId: true, productId: true },
  });

  if (campaignRows.length === 0) console.log("  (no campaigns)");
  for (const c of campaignRows) {
    const linked = links.filter((l) => l.campaignId === c.id).length;
    const from = c.startAt ? c.startAt.toISOString().slice(0, 10) : "open";
    const to = c.endAt ? c.endAt.toISOString().slice(0, 10) : "no end";
    console.log(`  ${c.slug} [${c.status}] ${linked} product(s), ${from} -> ${to}`);
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
    console.log("  - Catalogue is empty; run `npm run db:seed`.");
    notes += 1;
  }

  const placeholders = await prisma.paymentMethod.findMany({
    where: { active: true, accountNumber: { startsWith: "09X" } },
    select: { name: true },
  });
  if (placeholders.length > 0) {
    console.log(
      `  - Placeholder account numbers still seeded: ${list(placeholders.map((p) => p.name))}.` +
        " Customers cannot pay until these are replaced."
    );
    notes += 1;
  }

  if (!process.env.TEST_DATABASE_URL) {
    console.log(
      "  - TEST_DATABASE_URL is not set, so the integration tests in tests/ report as skipped."
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
