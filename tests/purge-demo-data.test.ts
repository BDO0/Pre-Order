import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PrismaClient } from "@prisma/client";
import { AUDITED_RULES } from "@/lib/capacity-audit";
import { readCounters, runPurge, type PurgeReport } from "@/lib/purge-demo-data";

// The purge, against a real Postgres. Like tests/order-concurrency.test.ts this
// only runs when TEST_DATABASE_URL is set, and it refuses to fall back to
// DATABASE_URL: the code under test deletes rows, and a suite that deletes rows
// from the development database is a suite nobody runs twice.
//
// What it proves, in the order it matters:
//   1. a dry run writes nothing at all — not a row, not even the backup folder;
//   2. an apply removes exactly the demo rows, leaves the real ones, and holds
//      itself back from the demo product a surviving order still points at;
//   3. the backup lands on disk, with the rows in it and a restore.sql beside it;
//   4. the capacity numbers are re-derived from what survived;
//   5. the same eight rules `npm run db:check` prints still hold afterwards;
//   6. the order reference counters did not move.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe.skipIf(!TEST_DATABASE_URL)("runPurge against a throwaway database", () => {
  let prisma!: PrismaClient;
  const suffix = uniqueSuffix();
  const backupBase = join(tmpdir(), `purge-test-${suffix}`);
  /** Every id this suite creates, so afterAll can take them all away again. */
  const created: Record<string, string[]> = {
    auditLogs: [],
    statusHistory: [],
    orderItems: [],
    orders: [],
    customers: [],
    variants: [],
    products: [],
    batches: [],
  };
  let counterDay!: Date;

  const demoBatchSlug = "september-drop-2026";
  const nextBatchSlug = `october-drop-${suffix}`;
  const realHandle = `real.customer.${suffix}`;
  const demoHandle = `demo.customer.${suffix}`;
  const probeHandle = `e2e.probe.${suffix}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    ({ prisma } = await import("@/lib/db"));

    // A fixture whose shape follows the live database: a demo drop with two
    // hand-made products, a real product in the next drop, and one order that
    // mixes demo stock with real stock.
    const september = await prisma.batch.create({
      data: { name: "September Drop 2026", slug: demoBatchSlug, status: "OPEN" },
    });
    const october = await prisma.batch.create({
      data: { name: "October Drop", slug: nextBatchSlug, status: "DRAFT" },
    });
    created.batches.push(september.id, october.id);

    const parka = await prisma.product.create({
      data: {
        name: "Parka",
        slug: "parka",
        price: 3000,
        images: [`/uploads/parka-${suffix}.webp`],
        active: true,
        preorderEnabled: true,
        preorderStatus: "OPEN",
      },
    });
    const sweatshirt = await prisma.product.create({
      data: {
        name: "SweatShirt",
        slug: "sweatshirt",
        price: 2000,
        images: [],
        active: true,
        preorderEnabled: true,
        preorderStatus: "OPEN",
        // One unit is held by the mixed order below; the fixture's numbers are
        // consistent, so only the dress carries a wrong one on purpose.
        preorderReserved: 1,
      },
    });
    // Deliberately NOT on the demo list: the product the purge must not touch.
    const dress = await prisma.product.create({
      data: {
        name: "Linen Dress",
        slug: `linen-dress-${suffix}`,
        price: 2500,
        images: [],
        active: true,
        preorderEnabled: true,
        preorderStatus: "OPEN",
        preorderReserved: 1,
      },
    });
    created.products.push(parka.id, sweatshirt.id, dress.id);

    const parkaVariant = await prisma.productVariant.create({
      data: { productId: parka.id, size: "L", color: "Black/Blue/Red", capacity: null },
    });
    const sweatVariant = await prisma.productVariant.create({
      data: {
        productId: sweatshirt.id,
        size: "S",
        color: "Black",
        capacity: 5,
        remainingCapacity: 4,
      },
    });
    const dressVariant = await prisma.productVariant.create({
      data: {
        productId: dress.id,
        size: "M",
        color: "Ivory",
        capacity: 10,
        // Wrong on purpose: one unit is held by the order below, and the purge
        // is what puts this right.
        remainingCapacity: 10,
      },
    });
    created.variants.push(parkaVariant.id, sweatVariant.id, dressVariant.id);

    for (const [batchId, productId] of [
      [september.id, parka.id],
      [september.id, sweatshirt.id],
      [october.id, dress.id],
    ] as const) {
      await prisma.batchProduct.create({ data: { batchId, productId } });
    }
    const septemberBatch = await prisma.batch.findUniqueOrThrow({
      where: { slug: demoBatchSlug },
    });
    const octoberBatch = await prisma.batch.findUniqueOrThrow({
      where: { slug: nextBatchSlug },
    });

    const demoCustomer = await prisma.customer.create({
      data: { fullName: "Demo Customer", instagramHandle: demoHandle },
    });
    const realCustomer = await prisma.customer.create({
      data: { fullName: "Real Customer", instagramHandle: realHandle },
    });
    const probeCustomer = await prisma.customer.create({
      data: { fullName: "E2E Probe", instagramHandle: probeHandle },
    });
    created.customers.push(demoCustomer.id, realCustomer.id, probeCustomer.id);

    const demoOrder = await prisma.order.create({
      data: {
        reference: `PO-TEST-${suffix}-1`,
        batchId: septemberBatch.id,
        customerId: demoCustomer.id,
        status: "COMPLETED",
        paymentStatus: "PAID",
        subtotal: 6000,
        total: 6000,
        customerSnapshot: { fullName: "Demo Customer", instagramHandle: demoHandle, answers: [] },
        items: {
          create: [
            {
              variantId: parkaVariant.id,
              quantity: 2,
              unitPriceAtPurchase: 3000,
              productNameSnapshot: "Parka",
              variantSnapshot: { size: "L", color: "Black/Blue/Red" },
            },
          ],
        },
      },
      include: { items: true },
    });
    created.orders.push(demoOrder.id);
    created.orderItems.push(...demoOrder.items.map((item) => item.id));

    // Mixed on purpose: one unit of the real dress and one of the demo
    // SweatShirt. This order survives, which is what makes the SweatShirt
    // un-deletable — deleting its variant would mean editing the order.
    const mixedOrder = await prisma.order.create({
      data: {
        reference: `PO-TEST-${suffix}-2`,
        batchId: octoberBatch.id,
        customerId: realCustomer.id,
        status: "CONFIRMED",
        subtotal: 4500,
        total: 4500,
        customerSnapshot: { fullName: "Real Customer", instagramHandle: realHandle, answers: [] },
        items: {
          create: [
            {
              variantId: dressVariant.id,
              quantity: 1,
              unitPriceAtPurchase: 2500,
              productNameSnapshot: "Linen Dress",
              variantSnapshot: { size: "M", color: "Ivory" },
            },
            {
              variantId: sweatVariant.id,
              quantity: 1,
              unitPriceAtPurchase: 2000,
              productNameSnapshot: "SweatShirt",
              variantSnapshot: { size: "S", color: "Black" },
            },
          ],
        },
      },
      include: { items: true },
    });
    created.orders.push(mixedOrder.id);
    created.orderItems.push(...mixedOrder.items.map((item) => item.id));

    for (const [orderId, toStatus] of [
      [demoOrder.id, "COMPLETED"],
      [mixedOrder.id, "CONFIRMED"],
    ] as const) {
      const row = await prisma.orderStatusHistory.create({
        data: { orderId, fromStatus: "PENDING", toStatus, changedBy: "test" },
      });
      created.statusHistory.push(row.id);
    }

    const auditRows = await prisma.auditLog.createManyAndReturn({
      data: [
        { orderId: demoOrder.id, actor: "customer", action: "order.created" },
        { orderId: mixedOrder.id, actor: "customer", action: "order.created" },
        { actor: `probe-${suffix}@local.test`, action: "batch.created" },
        { actor: "admin@anaclothing.com", action: "product.created", newValue: { id: parka.id } },
        { actor: "admin@anaclothing.com", action: "product.created", newValue: { id: dress.id } },
        { actor: "cli:admin-create", action: "admin.password_reset" },
      ],
      select: { id: true },
    });
    created.auditLogs.push(...auditRows.map((row) => row.id));

    counterDay = new Date("2026-09-17T00:00:00.000Z");
    await prisma.orderCounter.create({ data: { day: counterDay, lastValue: 311 } });
  });

  afterAll(async () => {
    if (!prisma) return;

    // Children first, then parents: the order the purge itself uses, because
    // nothing in this schema cascades.
    await prisma.auditLog.deleteMany({ where: { id: { in: created.auditLogs } } });
    await prisma.orderStatusHistory.deleteMany({ where: { id: { in: created.statusHistory } } });
    await prisma.orderItem.deleteMany({ where: { id: { in: created.orderItems } } });
    await prisma.order.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.customer.deleteMany({ where: { id: { in: created.customers } } });
    await prisma.batchProduct.deleteMany({ where: { batchId: { in: created.batches } } });
    await prisma.productVariant.deleteMany({ where: { id: { in: created.variants } } });
    await prisma.product.deleteMany({ where: { id: { in: created.products } } });
    await prisma.batch.deleteMany({ where: { id: { in: created.batches } } });
    await prisma.orderCounter.deleteMany({ where: { day: counterDay } });

    await rm(backupBase, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  /**
   * The rows this suite owns, counted.
   *
   * Counted by id (or by the slugs the suite picked) rather than by table: the
   * integration suite shares this database with the order-concurrency suite,
   * and a global `count()` would make this file depend on that one's leftovers.
   */
  async function counts() {
    return {
      batches: await prisma.batch.count({ where: { id: { in: created.batches } } }),
      products: await prisma.product.count({
        where: { slug: { in: ["parka", "sweatshirt"] } },
      }),
      variants: await prisma.productVariant.count({ where: { id: { in: created.variants } } }),
      links: await prisma.batchProduct.count({ where: { batchId: { in: created.batches } } }),
      orders: await prisma.order.count({ where: { id: { in: created.orders } } }),
      items: await prisma.orderItem.count({ where: { id: { in: created.orderItems } } }),
      history: await prisma.orderStatusHistory.count({
        where: { id: { in: created.statusHistory } },
      }),
      audits: await prisma.auditLog.count({ where: { id: { in: created.auditLogs } } }),
      customers: await prisma.customer.count({ where: { id: { in: created.customers } } }),
    };
  }

  let countersBefore: { day: string; lastValue: number }[] = [];
  let appliedReport!: PurgeReport;

  it("a dry run plans the purge and writes nothing at all", async () => {
    const before = await counts();
    countersBefore = await readCounters(prisma);

    const report = await runPurge(prisma, TEST_DATABASE_URL as string, {
      apply: false,
      backupDir: backupBase,
      productSlugs: ["parka", "sweatshirt"],
      batchSlugs: [demoBatchSlug],
    });

    expect(report.applied).toBe(false);
    expect(report.deleted).toEqual({});
    expect(report.backup).toBeNull();
    // The SweatShirt is already held back in the plan itself, not discovered
    // during the delete: the surviving order claims its variant, so the plan
    // never contains it. A dry run shows the plan that would be applied.
    expect(report.plan.delete.products.map((row) => row.slug)).toEqual(["parka"]);
    expect(report.plan.blocked.some((row) => row.label.startsWith("sweatshirt"))).toBe(true);
    expect(report.plan.delete.orders).toHaveLength(1);
    expect(await counts()).toEqual(before);
    // Not even the backup folder: a dry run has no side effects whatsoever.
    await expect(stat(backupBase)).rejects.toThrow();
  });

  it("removes the demo rows and holds back what a surviving order still claims", async () => {
    const report = await runPurge(prisma, TEST_DATABASE_URL as string, {
      apply: true,
      backupDir: backupBase,
      productSlugs: ["parka", "sweatshirt"],
      batchSlugs: [demoBatchSlug],
    });
    appliedReport = report;

    expect(report.applied).toBe(true);
    expect(report.deleted).toEqual({
      audit_logs: 3,
      order_status_history: 1,
      order_items: 1,
      orders: 1,
      customers: 2,
      batch_products: 2,
      product_variants: 1,
      products: 1,
      batches: 1,
    });

    // Gone: the Parka, the demo drop, the order that held it, and the two
    // customers that existed only for demo stock (one of them with no orders).
    expect(await prisma.product.count({ where: { slug: "parka" } })).toBe(0);
    expect(await prisma.batch.count({ where: { slug: demoBatchSlug } })).toBe(0);
    expect(await prisma.order.count({ where: { id: created.orders[0] } })).toBe(0);
    expect(await prisma.customer.count({ where: { instagramHandle: demoHandle } })).toBe(0);
    expect(await prisma.customer.count({ where: { instagramHandle: probeHandle } })).toBe(0);

    // Held back, with the reason: the surviving order claims its variant, so
    // deleting the product would mean deleting (or editing) that order.
    expect(report.plan.blocked.some((row) => row.label.startsWith("sweatshirt"))).toBe(true);
    expect(await prisma.product.count({ where: { slug: "sweatshirt" } })).toBe(1);

    // The real order, its items, its history and its customer are untouched.
    expect(await prisma.order.count({ where: { id: created.orders[1] } })).toBe(1);
    expect(await prisma.orderItem.count({ where: { orderId: created.orders[1] } })).toBe(2);
    expect(
      await prisma.orderStatusHistory.count({ where: { orderId: created.orders[1] } })
    ).toBe(1);
    expect(await prisma.customer.count({ where: { instagramHandle: realHandle } })).toBe(1);

    // Audit rows: the deleted order's and the probe's went, the ones describing
    // what stayed did not.
    expect(await prisma.auditLog.count({ where: { id: created.auditLogs[0] } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { id: created.auditLogs[2] } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { id: created.auditLogs[3] } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { id: created.auditLogs[1] } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { id: created.auditLogs[4] } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { id: created.auditLogs[5] } })).toBe(1);
  });

  it("wrote the backup before deleting, and it holds whole rows", async () => {
    // One timestamped folder, found rather than guessed.
    const entries = await readdir(backupBase);
    expect(entries).toHaveLength(1);
    const dir = join(backupBase, entries[0]);

    const products = JSON.parse(await readFile(join(dir, "products.json"), "utf8"));
    expect(products).toHaveLength(1);
    expect(products[0].slug).toBe("parka");
    // Every column, not just the handful the plan needed.
    expect(products[0].preorderStatus).toBe("OPEN");

    const orders = JSON.parse(await readFile(join(dir, "orders.json"), "utf8"));
    expect(orders.map((row: { reference: string }) => row.reference)).toEqual([
      `PO-TEST-${suffix}-1`,
    ]);

    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    expect(manifest.deleting.products).toEqual(["parka"]);
    expect(manifest.rows.products).toBe(1);
    expect(manifest.database.host).toBeTruthy();

    const restore = await readFile(join(dir, "restore.sql"), "utf8");
    expect(restore).toContain('INSERT INTO "products"');
    expect(restore).toContain("'parka'");
  });

  it("re-derives the stock a surviving order holds, and leaves the counters alone", async () => {
    const dressVariant = await prisma.productVariant.findFirstOrThrow({
      where: { product: { slug: `linen-dress-${suffix}` } },
    });

    // The fixture's number was stale — ten remaining with one unit held — so the
    // purge derives what it should be from the order items that survived.
    expect(appliedReport.capacityUpdates).toEqual([
      { kind: "variant", id: dressVariant.id, label: "Ivory/M", from: 10, to: 9 },
    ]);
    expect(
      (await prisma.productVariant.findUniqueOrThrow({ where: { id: dressVariant.id } }))
        .remainingCapacity
    ).toBe(9);

    // The SweatShirt's numbers were already right, so nothing is rewritten:
    // five made, one claimed, and the product's total agrees.
    const sweatVariant = await prisma.productVariant.findFirstOrThrow({
      where: { product: { slug: "sweatshirt" } },
    });
    expect(sweatVariant.remainingCapacity).toBe(4);
    expect(sweatVariant.capacity).toBe(5);

    // The reference counters are exactly where they were. A counter that moved
    // would hand the next checkout a number already on a customer's screen.
    expect(await readCounters(prisma)).toEqual(countersBefore);
    expect(appliedReport.countersUnchanged).toBe(true);

    // And every rule `npm run db:check` prints still holds.
    expect(appliedReport.findings.map((finding) => finding.rule)).toEqual([...AUDITED_RULES]);
    expect(appliedReport.findings.filter((finding) => !finding.pass)).toEqual([]);
  });
});
