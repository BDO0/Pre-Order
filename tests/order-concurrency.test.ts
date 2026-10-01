import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { OrderSubmission } from "@/lib/validation";
import { readSnapshotAnswers } from "@/lib/order-answers";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

type CreateOrder = (typeof import("@/lib/order-service"))["createOrder"];
type ReleaseCapacity = (typeof import("@/lib/order-service"))["releaseOrderCapacity"];

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe.skipIf(!TEST_DATABASE_URL)("createOrder capacity guarantees", () => {
  let prisma!: PrismaClient;
  let createOrder!: CreateOrder;
  let releaseOrderCapacity!: ReleaseCapacity;
  let batchId!: string;
  const productIds: string[] = [];
  const formFieldKeys: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;

    ({ prisma } = await import("@/lib/db"));
    ({ createOrder, releaseOrderCapacity } = await import("@/lib/order-service"));

    const batch = await prisma.batch.create({
      data: { name: "Concurrency suite", slug: `suite-${uniqueSuffix()}`, status: "OPEN" },
    });
    batchId = batch.id;
  });

  afterEach(async () => {
    if (!prisma || formFieldKeys.length === 0) return;

    await prisma.orderFormField.updateMany({
      where: { key: { in: formFieldKeys } },
      data: { active: false, deletedAt: new Date() },
    });
  });

  afterAll(async () => {
    if (!prisma) return;

    const suiteOrders = await prisma.order.findMany({
      where: { batchId },
      select: { customerId: true },
    });
    const customerIds = [
      ...new Set(
        suiteOrders.map((order) => order.customerId).filter((id): id is string => id !== null)
      ),
    ];

    await prisma.orderItem.deleteMany({
      where: { variant: { productId: { in: productIds } } },
    });
    await prisma.orderStatusHistory.deleteMany({ where: { order: { batchId } } });
    await prisma.auditLog.deleteMany({ where: { order: { batchId } } });
    await prisma.order.deleteMany({ where: { batchId } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.batchProduct.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.orderFormField.deleteMany({ where: { key: { in: formFieldKeys } } });
    await prisma.batch.delete({ where: { id: batchId } });
    await prisma.$disconnect();
  });

  async function makeProduct(options: {
    variantCapacity: number | null;
    preorderLimit?: number | null;
  }) {
    const product = await prisma.product.create({
      data: {
        name: "Concurrency Shirt",
        slug: `concurrency-shirt-${uniqueSuffix()}`,
        price: 100,
        images: [],
        active: true,
        preorderEnabled: true,
        preorderStatus: "OPEN",
        preorderLimit: options.preorderLimit ?? null,
        preorderReserved: 0,
      },
    });
    productIds.push(product.id);

    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        size: "M",
        color: "Black",
        capacity: options.variantCapacity,
        remainingCapacity: options.variantCapacity,
        active: true,
      },
    });

    await prisma.batchProduct.create({
      data: { batchId, productId: product.id },
    });

    return { product, variant };
  }

  async function makeField(overrides: {
    label: string;
    type?: "TEXT" | "TEXTAREA" | "PHONE" | "EMAIL" | "NUMBER" | "SELECT";
    required?: boolean;
    options?: string[];
    sensitive?: boolean;
    active?: boolean;
  }) {
    const key = `suite_${uniqueSuffix()}`;
    formFieldKeys.push(key);

    return prisma.orderFormField.create({
      data: {
        key,
        label: overrides.label,
        type: overrides.type ?? "TEXT",
        required: overrides.required ?? true,
        options: overrides.options ?? [],
        sensitive: overrides.sensitive ?? false,
        active: overrides.active ?? true,
      },
    });
  }

  function submission(
    variantId: string,
    quantity: number,
    answers: { fieldId: string; value: string }[] = []
  ): OrderSubmission {
    return {
      idempotencyKey: crypto.randomUUID(),
      batchId,
      items: [{ variantId, quantity }],
      customerInfo: {
        fullName: "Test Customer",
        instagramHandle: `tester${Math.random().toString(36).slice(2, 10)}`,
      },
      answers,
    };
  }

  it("never oversells a variant when checkouts run concurrently", async () => {
    const CAPACITY = 5;
    const ATTEMPTS = 15;
    const { variant } = await makeProduct({ variantCapacity: CAPACITY });

    const results = await Promise.allSettled(
      Array.from({ length: ATTEMPTS }, () => createOrder(submission(variant.id, 1)))
    );

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );

    expect(fulfilled).toHaveLength(CAPACITY);
    expect(rejected).toHaveLength(ATTEMPTS - CAPACITY);

    for (const failure of rejected) {
      expect(failure.reason).toMatchObject({ code: "INSUFFICIENT_CAPACITY" });
    }

    const after = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(after.remainingCapacity).toBe(0);

    const sold = await prisma.orderItem.aggregate({
      where: { variantId: variant.id },
      _sum: { quantity: true },
    });
    expect(sold._sum.quantity).toBe(CAPACITY);
  });

  it("enforces the product pre-order limit when the variant is unlimited", async () => {
    const LIMIT = 3;
    const ATTEMPTS = 15;
    const { product, variant } = await makeProduct({
      variantCapacity: null,
      preorderLimit: LIMIT,
    });

    const results = await Promise.allSettled(
      Array.from({ length: ATTEMPTS }, () => createOrder(submission(variant.id, 1)))
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(LIMIT);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.preorderReserved).toBe(LIMIT);

    const variantAfter = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(variantAfter.remainingCapacity).toBeNull();
  });

  it("gives every concurrent order a unique, well-formed reference", async () => {
    const COUNT = 12;
    const { variant } = await makeProduct({ variantCapacity: null });

    const results = await Promise.all(
      Array.from({ length: COUNT }, () => createOrder(submission(variant.id, 1)))
    );

    const references = results.map((result) => result.order.reference);
    expect(new Set(references).size).toBe(COUNT);

    for (const reference of references) {
      expect(reference).toMatch(/^PO-\d{8}-\d{4,}$/);
    }
  });

  it("reuses the existing order when the same idempotency key is submitted twice", async () => {
    const { variant } = await makeProduct({ variantCapacity: 1 });
    const payload = submission(variant.id, 1);

    const first = await createOrder(payload);
    const second = await createOrder(payload);

    expect(second.idempotent).toBe(true);
    expect(second.order.reference).toBe(first.order.reference);

    const after = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(after.remainingCapacity).toBe(0);
  });

  it("returns reserved capacity to the pool when an order is voided", async () => {
    const { product, variant } = await makeProduct({ variantCapacity: 4 });

    const created = await createOrder(submission(variant.id, 2));
    const reserved = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(reserved.remainingCapacity).toBe(2);

    const order = await prisma.order.findFirstOrThrow({
      where: { reference: created.order.reference },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED" },
      });
      await releaseOrderCapacity(tx, order.id);
    });

    const variantAfter = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(variantAfter.remainingCapacity).toBe(4);

    const productAfter = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
    });
    expect(productAfter.preorderReserved).toBe(0);
  });

  it("refuses an order that skips a required question, consuming nothing", async () => {
    const { product, variant } = await makeProduct({ variantCapacity: 2 });
    const size = await makeField({
      label: "Size",
      type: "SELECT",
      options: ["Small", "Large"],
    });

    const payload = submission(variant.id, 1);
    await expect(createOrder(payload)).rejects.toMatchObject({ code: "FORM_FIELD_REQUIRED" });

    const variantAfter = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(variantAfter.remainingCapacity).toBe(2);

    const productAfter = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
    });
    expect(productAfter.preorderReserved).toBe(0);

    expect(
      await prisma.customer.count({
        where: { instagramHandle: payload.customerInfo.instagramHandle },
      })
    ).toBe(0);

    const answered = await createOrder(
      submission(variant.id, 1, [{ fieldId: size.key, value: "Small" }])
    );
    expect(answered.idempotent).toBe(false);
  });

  it("stores each answer with the label, type and sensitivity that were on screen", async () => {
    const { variant } = await makeProduct({ variantCapacity: 1 });
    const size = await makeField({
      label: "Size",
      type: "SELECT",
      options: ["Small", "Large"],
    });
    const mobile = await makeField({ label: "Mobile Number", type: "PHONE", sensitive: true });

    const created = await createOrder(
      submission(variant.id, 1, [
        { fieldId: size.key, value: "large" },
        { fieldId: mobile.key, value: "  0917 123 4567  " },
      ])
    );

    const order = await prisma.order.findFirstOrThrow({
      where: { reference: created.order.reference },
      select: { customerSnapshot: true },
    });

    expect(readSnapshotAnswers(order.customerSnapshot)).toEqual([
      {
        key: size.key,
        label: "Size",
        type: "SELECT",
        value: "Large",
        sensitive: false,
      },
      {
        key: mobile.key,
        label: "Mobile Number",
        type: "PHONE",
        value: "0917 123 4567",
        sensitive: true,
      },
    ]);
  });

  it("ignores a question that is switched off or deleted, so nobody can answer it", async () => {
    const { variant } = await makeProduct({ variantCapacity: 1 });
    const hidden = await makeField({ label: "Hidden question", active: false });

    await expect(
      createOrder(submission(variant.id, 1, [{ fieldId: hidden.key, value: "yes" }]))
    ).rejects.toMatchObject({ code: "INVALID_FORM_FIELD" });

    await prisma.orderFormField.update({
      where: { id: hidden.id },
      data: { active: true, deletedAt: new Date() },
    });

    await expect(
      createOrder(submission(variant.id, 1, [{ fieldId: hidden.key, value: "yes" }]))
    ).rejects.toMatchObject({ code: "INVALID_FORM_FIELD" });
  });
});
