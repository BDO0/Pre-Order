import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  AUDITED_RULES,
  auditCapacity,
  holdingOrderIds,
} from "@/lib/capacity-audit";
import { databaseIdentity } from "@/lib/purge-demo-data";
import {
  DEMO_BATCH_SLUGS,
  DEMO_PRODUCT_SLUGS,
  insertStatements,
  pgLiteral,
  planCapacityRecompute,
  planPurge,
  type PurgeAuditLogRow,
  type PurgeCustomerRow,
  type PurgeInput,
  type PurgeOrderItemRow,
  type PurgeOrderRow,
  type PurgeProductRow,
  type PurgeVariantRow,
} from "@/lib/purge-plan";

// A database shaped like the live one: the demo products, an order that sits
// entirely on demo stock, an order that mixes demo stock with a real product,
// and a real order. Every rule the purge applies can be observed here without
// going near a database — which is the only way to prove a *delete* selection
// is correct before it runs.

function product(id: string, slug: string, name: string): PurgeProductRow {
  return {
    id,
    slug,
    name,
    active: true,
    preorderStatus: slug === "basic-tee" ? "COMING_SOON" : "OPEN",
    images: [],
    preorderLimit: null,
    preorderReserved: 0,
    createdAt: new Date("2026-09-17T06:40:22.625Z"),
  };
}

function variant(
  id: string,
  productId: string,
  size: string | null,
  color: string | null,
  capacity: number | null,
  remainingCapacity: number | null
): PurgeVariantRow {
  return { id, productId, size, color, capacity, remainingCapacity };
}

function order(
  id: string,
  reference: string,
  status: string,
  batchId: string,
  customerId: string | null
): PurgeOrderRow {
  return { id, reference, status, batchId, customerId, createdAt: new Date("2026-09-17T09:03:55Z") };
}

function item(id: string, orderId: string, variantId: string, quantity: number): PurgeOrderItemRow {
  return { id, orderId, variantId, quantity };
}

function audit(
  id: string,
  orderId: string | null,
  actor: string,
  action: string,
  json: unknown
): PurgeAuditLogRow {
  return {
    id,
    orderId,
    actor,
    action,
    createdAt: new Date("2026-09-17T09:03:55Z"),
    metadata: json,
  };
}

function customer(id: string, instagramHandle: string): PurgeCustomerRow {
  return { id, instagramHandle, fullName: instagramHandle, createdAt: new Date("2026-09-17T09:00:00Z") };
}

function fixture(overrides: Partial<PurgeInput> = {}): PurgeInput {
  return {
    products: [
      product("p-shirt", "oversized-cotton-shirt", "Oversized Cotton Shirt"),
      product("p-pants", "korean-cargo-pants", "Korean Cargo Pants"),
      product("p-tee", "basic-tee", "Basic Tee"),
      product("p-parka", "parka", "Parka"),
      product("p-sweat", "sweatshirt", "SweatShirt"),
      { ...product("p-real", "linen-dress", "Linen Dress"), preorderReserved: 1 },
    ],
    variants: [
      variant("v-shirt", "p-shirt", "L", "Black", 10, 9),
      variant("v-pants", "p-pants", "28", "Beige", 10, 10),
      variant("v-parka", "p-parka", "L", "Black/Blue/Red", null, null),
      variant("v-sweat", "p-sweat", "S", "Black", null, null),
      variant("v-real", "p-real", "M", "Ivory", 5, 4),
    ],
    batches: [
      { id: "b-demo", slug: "september-drop-2026", name: "September Drop 2026", status: "OPEN" },
      { id: "b-next", slug: "october-drop-2026", name: "October Drop 2026", status: "DRAFT" },
    ],
    batchProducts: [
      { batchId: "b-demo", productId: "p-shirt" },
      { batchId: "b-demo", productId: "p-pants" },
      { batchId: "b-demo", productId: "p-tee" },
      { batchId: "b-demo", productId: "p-parka" },
      { batchId: "b-demo", productId: "p-sweat" },
      { batchId: "b-next", productId: "p-real" },
    ],
    orders: [
      order("o-shirt", "PO-20260917-0045", "COMPLETED", "b-demo", "c-juan"),
      order("o-parka", "PO-20260917-0090", "COMPLETED", "b-demo", "c-sd"),
      order("o-real", "PO-20260917-0200", "CONFIRMED", "b-next", "c-real"),
    ],
    orderItems: [
      item("i1", "o-shirt", "v-shirt", 1),
      item("i2", "o-parka", "v-parka", 2),
      item("i3", "o-parka", "v-sweat", 2),
      item("i4", "o-real", "v-real", 1),
    ],
    statusHistory: [
      { id: "h1", orderId: "o-shirt" },
      { id: "h2", orderId: "o-parka" },
      { id: "h3", orderId: "o-real" },
    ],
    auditLogs: [
      audit("a1", "o-shirt", "customer", "order.created", { reference: "PO-20260917-0045" }),
      audit("a2", "o-parka", "customer", "order.created", { reference: "PO-20260917-0090" }),
      audit("a3", "o-real", "customer", "order.created", { reference: "PO-20260917-0200" }),
      audit("a4", null, "probe-bf6fe581@local.test", "batch.created", {}),
      audit("a5", null, "admin@anaclothing.com", "product.created", { id: "p-parka" }),
      audit("a6", null, "admin@anaclothing.com", "product.created", { id: "p-real" }),
      audit("a7", null, "cli:admin-create", "admin.password_reset", {}),
    ],
    customers: [
      customer("c-juan", "juandc"),
      customer("c-sd", "sd"),
      customer("c-probe", "e2e.probe.001"),
      customer("c-idle", "quiet.browser"),
      customer("c-real", "real.customer"),
    ],
    ...overrides,
  };
}

const ids = (rows: readonly { id: string }[]): string[] => rows.map((row) => row.id);

describe("planPurge", () => {
  it("selects the demo products and everything hanging off them, and nothing else", () => {
    const plan = planPurge(fixture());

    expect(plan.delete.products.map((p) => p.slug).sort()).toEqual([...DEMO_PRODUCT_SLUGS].sort());
    // Every variant of a deleted product goes, including ones that never sold.
    expect(ids(plan.delete.variants).sort()).toEqual(["v-pants", "v-parka", "v-shirt", "v-sweat"]);
    expect(plan.delete.batches.map((b) => b.slug)).toEqual([...DEMO_BATCH_SLUGS]);
    expect(plan.delete.orders.map((o) => o.reference).sort()).toEqual([
      "PO-20260917-0045",
      "PO-20260917-0090",
    ]);
    expect(ids(plan.delete.orderItems).sort()).toEqual(["i1", "i2", "i3"]);
    expect(ids(plan.delete.statusHistory).sort()).toEqual(["h1", "h2"]);
    expect(plan.delete.customers.map((c) => c.instagramHandle).sort()).toEqual([
      "e2e.probe.001",
      "juandc",
      "sd",
    ]);
    // The five links into the demo drop, and not the link into the next drop.
    expect(plan.delete.batchProducts).toHaveLength(5);
    expect(plan.blocked).toEqual([]);
  });

  it("keeps the real order, its product and its customer, and says why", () => {
    const plan = planPurge(fixture());

    expect(ids(plan.delete.orders)).not.toContain("o-real");
    expect(ids(plan.delete.customers)).not.toContain("c-real");
    expect(ids(plan.delete.variants)).not.toContain("v-real");
    expect(plan.kept).toContainEqual({
      label: "linen-dress (Linen Dress)",
      reason: "not on the demo list",
    });
  });

  it("takes the audit rows that describe what is going, and leaves the rest", () => {
    const plan = planPurge(fixture());

    // a1/a2 belong to deleted orders; a4 was written by a throwaway probe; a5
    // names the Parka, which is going.
    expect(ids(plan.delete.auditLogs).sort()).toEqual(["a1", "a2", "a4", "a5"]);
    // a3 belongs to the surviving order; a6 names a product that stays; a7 is a
    // real password reset with no entity in it at all.
    expect(plan.keptAuditLogs).toHaveLength(3);
    expect(plan.keptAuditLogs.map((row) => row.label).join("\n")).toContain("admin.password_reset");
  });

  it("keeps a customer that has never ordered unless the handle is a test handle", () => {
    const plan = planPurge(fixture());

    expect(ids(plan.delete.customers)).not.toContain("c-idle");
    expect(plan.notes.join("\n")).toContain("@quiet.browser has no orders");
  });

  it("--keep spares the product, the order holding it, and the product that order also touches", () => {
    const plan = planPurge(fixture(), { keepProductSlugs: ["parka"] });

    expect(plan.kept).toContainEqual({ label: "parka (Parka)", reason: "--keep" });
    expect(plan.delete.products.map((p) => p.slug)).not.toContain("parka");
    // The order that holds the kept Parka stays, so its SweatShirt cannot go
    // either: removing a variant an order still points at would be editing
    // history to make a deletion convenient.
    expect(ids(plan.delete.orders)).not.toContain("o-parka");
    expect(plan.delete.products.map((p) => p.slug)).not.toContain("sweatshirt");
    expect(plan.blocked.some((row) => row.label.startsWith("sweatshirt"))).toBe(true);
  });

  it("--keep-order holds back that order's products instead of editing history", () => {
    const plan = planPurge(fixture(), { keepOrderRefs: ["PO-20260917-0045"] });

    expect(ids(plan.delete.orders)).not.toContain("o-shirt");
    expect(plan.delete.products.map((p) => p.slug)).not.toContain("oversized-cotton-shirt");
    expect(plan.blocked.some((row) => row.reason === "--keep-order")).toBe(true);
  });

  it("refuses to delete the batch an order stays in", () => {
    // Here the surviving order is in the *next* drop, so nothing stops the demo
    // batch going. Move it into the demo batch and the batch has to stay with
    // it, because orders.batchId is a foreign key.
    const input = fixture();
    const plan = planPurge({
      ...input,
      orders: input.orders.map((row) =>
        row.id === "o-real" ? { ...row, batchId: "b-demo" } : row
      ),
    });

    expect(plan.delete.batches).toEqual([]);
    expect(plan.blocked.some((row) => row.label.startsWith("september-drop-2026"))).toBe(true);
    // The links still go: the products they join are being deleted anyway.
    expect(plan.delete.batchProducts).toHaveLength(5);
  });

  it("purges what --product names instead of the built-in list", () => {
    const plan = planPurge(fixture(), { productSlugs: ["linen-dress"], batchSlugs: [] });

    expect(plan.delete.products.map((p) => p.slug)).toEqual(["linen-dress"]);
    // The only order on it goes with it, and so does its customer. The probe
    // customer goes too: that rule does not depend on which product is chosen.
    expect(plan.delete.orders.map((o) => o.reference)).toEqual(["PO-20260917-0200"]);
    expect(plan.delete.customers.map((c) => c.instagramHandle)).toEqual([
      "e2e.probe.001",
      "real.customer",
    ]);
    expect(plan.delete.batches).toEqual([]);
  });

  it("records a missing slug as a note rather than failing", () => {
    const plan = planPurge(fixture(), { productSlugs: ["not-in-this-database"] });

    expect(plan.delete.products).toEqual([]);
    expect(plan.notes.join("\n")).toContain("not-in-this-database");
    expect(plan.notes.join("\n")).toContain("nothing on the demo list is present");
  });

  it("reports the imagery of the products it deletes, and deletes no files", () => {
    const input = fixture();
    const plan = planPurge({
      ...input,
      products: input.products.map((row) =>
        row.slug === "parka" ? { ...row, images: ["/uploads/parka.webp"] } : row
      ),
    });

    expect(plan.orphanedImages).toEqual(["/uploads/parka.webp"]);
  });

  it("keeps an order that mixes demo stock with real stock, and that demo product with it", () => {
    const input = fixture();
    const plan = planPurge({
      ...input,
      orderItems: [...input.orderItems, item("i9", "o-shirt", "v-real", 1)],
    });

    expect(ids(plan.delete.orders)).not.toContain("o-shirt");
    expect(plan.delete.products.map((p) => p.slug)).not.toContain("oversized-cotton-shirt");
    expect(plan.blocked.some((row) => row.label.startsWith("oversized-cotton-shirt"))).toBe(true);
    // The order's status history stays with it.
    expect(ids(plan.delete.statusHistory)).not.toContain("h1");
  });
});

describe("planCapacityRecompute", () => {
  /** The rows that survive the fixture: one real product, one order, one item. */
  function survivors() {
    const input = fixture();
    return {
      variants: [input.variants.find((v) => v.id === "v-real") as PurgeVariantRow],
      products: [input.products.find((p) => p.id === "p-real") as PurgeProductRow],
      orders: input.orders.filter((o) => o.id === "o-real"),
      orderItems: input.orderItems.filter((i) => i.orderId === "o-real"),
    };
  }

  it("says nothing when the stored numbers already match the orders", () => {
    // v-real: capacity 5, remaining 4; p-real: reserved 1. One unit is held.
    expect(planCapacityRecompute(survivors())).toEqual([]);
  });

  it("re-derives a variant that was not holding what it said", () => {
    const input = survivors();
    const updates = planCapacityRecompute({
      ...input,
      variants: [{ ...input.variants[0], remainingCapacity: 5 }],
    });

    expect(updates).toEqual([{ kind: "variant", id: "v-real", label: "Ivory/M", from: 5, to: 4 }]);
  });

  it("re-derives a product's preorderReserved from the orders that survive", () => {
    const input = survivors();
    const updates = planCapacityRecompute({
      ...input,
      products: [{ ...input.products[0], preorderReserved: 0 }],
    });

    expect(updates).toEqual([
      { kind: "product", id: "p-real", label: "linen-dress", from: 0, to: 1 },
    ]);
  });

  it("does not count a voided order: its units went back when it was voided", () => {
    const input = survivors();
    const updates = planCapacityRecompute({
      ...input,
      orders: input.orders.map((o) => ({ ...o, status: "CANCELLED" })),
    });

    // The unit is on the shelf again, which makes the stored 4 the wrong number
    // — and the product's cached total wrong with it.
    expect(updates).toEqual([
      { kind: "variant", id: "v-real", label: "Ivory/M", from: 4, to: 5 },
      { kind: "product", id: "p-real", label: "linen-dress", from: 1, to: 0 },
    ]);
  });

  it("leaves an unlimited variant unlimited", () => {
    const input = survivors();
    const updates = planCapacityRecompute({
      ...input,
      variants: [{ ...input.variants[0], capacity: null, remainingCapacity: null }],
    });

    expect(updates).toEqual([]);
  });
});

describe("pgLiteral", () => {
  it("writes the shapes a backup has to carry", () => {
    expect(pgLiteral(null)).toBe("NULL");
    expect(pgLiteral(undefined)).toBe("NULL");
    expect(pgLiteral(12)).toBe("12");
    expect(pgLiteral(12.5)).toBe("12.5");
    expect(pgLiteral(true)).toBe("TRUE");
    expect(pgLiteral("PO-20260917-0045")).toBe("'PO-20260917-0045'");
  });

  it("doubles a quote rather than ending the string early", () => {
    expect(pgLiteral("O'Brien")).toBe("'O''Brien'");
    expect(pgLiteral("back\\slash")).toBe("'back\\slash'");
  });

  it("writes a date the way Postgres reads it back", () => {
    expect(pgLiteral(new Date("2026-09-17T09:03:55.000Z"))).toBe("'2026-09-17T09:03:55.000Z'");
  });

  it("writes arrays, including the empty one", () => {
    expect(pgLiteral([])).toBe("'{}'");
    expect(pgLiteral(["/uploads/a.webp"])).toBe("ARRAY['/uploads/a.webp']");
  });

  it("writes an object as jsonb", () => {
    expect(pgLiteral({ size: "L", color: "Black" })).toBe(`'{"size":"L","color":"Black"}'::jsonb`);
  });

  it("writes a money column as a number, not as JSON", () => {
    // What every Decimal(10,2) column comes back as. Written as JSON this would
    // be `'"1299.00"'::jsonb`, which Postgres will not store in a numeric column
    // — a restore script that cannot run.
    expect(pgLiteral(new Prisma.Decimal("1299.00"))).toBe("1299");
    expect(pgLiteral(new Prisma.Decimal("1299.50"))).toBe("1299.5");
  });
});

describe("insertStatements", () => {
  it("names the columns it was given, one statement per row", () => {
    const statements = insertStatements(
      "products",
      ["id", "slug", "images"],
      [
        { id: "p1", slug: "parka", images: [] },
        { id: "p2", slug: "linen-dress", images: ["/uploads/a.webp"] },
      ]
    );

    expect(statements).toEqual([
      `INSERT INTO "products" ("id", "slug", "images") VALUES ('p1', 'parka', '{}');`,
      `INSERT INTO "products" ("id", "slug", "images") VALUES ('p2', 'linen-dress', ARRAY['/uploads/a.webp']);`,
    ]);
  });
});

describe("databaseIdentity", () => {
  it("takes the project ref from the pooler username", () => {
    const identity = databaseIdentity(
      "postgresql://postgres.ugpfxwurknjixbkxbrtq:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
    );

    expect(identity.projectRef).toBe("ugpfxwurknjixbkxbrtq");
    expect(identity.confirmToken).toBe("ugpfxwurknjixbkxbrtq");
    expect(identity.host).toBe("aws-0-ap-northeast-1.pooler.supabase.com");
    expect(identity.database).toBe("postgres");
  });

  it("takes it from the host on a direct connection", () => {
    const identity = databaseIdentity(
      "postgresql://postgres:secret@db.ugpfxwurknjixbkxbrtq.supabase.co:5432/postgres"
    );

    expect(identity.projectRef).toBe("ugpfxwurknjixbkxbrtq");
    expect(identity.confirmToken).toBe("ugpfxwurknjixbkxbrtq");
  });

  it("falls back to the host, so --confirm still names one database", () => {
    const identity = databaseIdentity("postgresql://postgres:postgres@127.0.0.1:5432/preorder_test");

    expect(identity.projectRef).toBeNull();
    expect(identity.confirmToken).toBe("127.0.0.1");
    expect(identity.database).toBe("preorder_test");
  });
});

describe("holdingOrderIds", () => {
  it("counts every order except the voided ones", () => {
    const holding = holdingOrderIds([
      { id: "o1", status: "COMPLETED" },
      { id: "o2", status: "CANCELLED" },
      { id: "o3", status: "REJECTED" },
      { id: "o4", status: "PENDING" },
    ]);

    expect([...holding].sort()).toEqual(["o1", "o4"]);
  });
});

describe("auditCapacity", () => {
  it("reports every rule, so a clean run says which rules ran", () => {
    const findings = auditCapacity({ variants: [], products: [], items: [], emptyOrders: [] });

    expect(findings.map((finding) => finding.rule)).toEqual([...AUDITED_RULES]);
    expect(findings.every((finding) => finding.pass)).toBe(true);
  });

  it("catches reserved stock beyond the limit, and names the product", () => {
    const findings = auditCapacity({
      variants: [],
      products: [{ id: "p1", slug: "parka", preorderLimit: 2, preorderReserved: 3 }],
      items: [],
      emptyOrders: [],
    });
    const failed = findings.filter((finding) => !finding.pass);
    const overLimit = failed.find(
      (finding) => finding.rule === "no product has reserved more than its preorderLimit"
    );

    // The reconciliation rule also notices — a product claiming 3 held units
    // with no order items to back them is wrong twice over — so the assertion
    // is about the rule that names the limit, not about the total count.
    expect(overLimit?.detail).toContain("parka: 3/2");
  });

  it("catches a variant holding more than it ever had", () => {
    const findings = auditCapacity({
      variants: [
        { id: "v1", productId: "p1", size: "L", color: "Black", capacity: 5, remainingCapacity: 6 },
      ],
      products: [],
      items: [],
      emptyOrders: [],
    });
    const failed = findings.filter((finding) => !finding.pass).map((finding) => finding.rule);

    // Both the bound and the reconciliation notice it: the row is wrong twice
    // over, and saying so is more useful than picking one of the two.
    expect(failed).toContain("no variant holds more remaining than its capacity");
    expect(failed).toContain("variant capacity consumed matches live order items");
  });

  it("catches an order that was left with no items", () => {
    const findings = auditCapacity({
      variants: [],
      products: [],
      items: [],
      emptyOrders: [{ reference: "PO-1", status: "COMPLETED" }],
    });
    const failed = findings.filter((finding) => !finding.pass);

    expect(failed).toHaveLength(1);
    expect(failed[0].detail).toContain("PO-1");
  });

  it("reconciles stored capacity against the items that still hold it", () => {
    const findings = auditCapacity({
      variants: [
        { id: "v1", productId: "p1", size: "L", color: "Black", capacity: 5, remainingCapacity: 3 },
      ],
      products: [{ id: "p1", slug: "parka", preorderLimit: null, preorderReserved: 2 }],
      items: [{ variantId: "v1", quantity: 2 }],
      emptyOrders: [],
    });

    expect(findings.every((finding) => finding.pass)).toBe(true);
  });
});
