import { prisma } from "@/lib/db";
import { generateAccessToken } from "@/lib/order-token";
import { generateOrderReference } from "@/lib/order-number";
import { detectDuplicate } from "@/lib/duplicate-detection";
import { OrderError } from "@/lib/order-error";
import type { OrderSubmission } from "@/lib/validation";
import type { Prisma } from "@prisma/client";

// Re-exported so every existing `import { OrderError } from "@/lib/order-service"`
// keeps working; the class itself lives in its own module so `order-form.ts` can
// throw it without creating an import cycle.
export { OrderError };



// ─────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────

/**
 * Returns the lower-cased target of a unique-constraint violation, or null if
 * the error is not a unique violation.
 *
 * Prisma maps Postgres' 23505 to P2002, but with a driver adapter the raw code
 * can surface instead, so both are accepted. Raw errors carry the constraint
 * name rather than a field list, hence the fallback.
 */
function uniqueViolationTarget(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;

  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002" && candidate.code !== "23505") return null;

  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.join(",").toLowerCase();
  if (typeof target === "string") return target.toLowerCase();

  const constraint = (error as { constraint?: unknown }).constraint;
  if (typeof constraint === "string") return constraint.toLowerCase();

  // Prisma 7 with a driver adapter can report the violation only through the
  // message ("Unique constraint failed on the constraint: `x_key`"), which made
  // this return "" and turned the reference retry below into dead code.
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message.toLowerCase() : "";
}

/** A collision on `orders.reference` — safe to retry with a new number. */
function isReferenceCollision(error: unknown): boolean {
  return uniqueViolationTarget(error)?.includes("reference") ?? false;
}

/** A collision on `orders.idempotencyKey` — the same form was sent twice. */
function isIdempotencyCollision(error: unknown): boolean {
  return uniqueViolationTarget(error)?.includes("idempotency") ?? false;
}

/**
 * A collision on `customers.instagramHandle` — two first orders from the same
 * account. Retryable: the second attempt finds the row the first one created.
 */
function isCustomerCollision(error: unknown): boolean {
  return uniqueViolationTarget(error)?.includes("instagramhandle") ?? false;
}

// ─────────────────────────────────────────────────────────────
// ORDER SERVICE
// ─────────────────────────────────────────────────────────────

/**
 * Creates a pre-order.
 *
 * What the customer sends is now deliberately tiny — who they are (name +
 * Instagram handle), what they want (items) and any answers the operator asked
 * for. Payment, delivery addresses and sizing are settled in DM, so none of them
 * are part of this payload and none of them can become a validation failure at
 * 2am.
 */
export async function createOrder(input: OrderSubmission) {
  // ── Step 1: Idempotency check ──────────────────────────────
  if (input.idempotencyKey) {
    const existing = await prisma.order.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      // `accessToken` is part of the answer: a resubmitted form must hand the
      // customer the same tracking link it handed the first one, not a page
      // with the token missing.
      select: { reference: true, total: true, status: true, accessToken: true },
    });
    if (existing) {
      return { idempotent: true, order: existing };
    }
  }

  // ── Step 2: Validate batch ──────────────────────────────
  const batch = await prisma.batch.findUnique({
    where: { id: input.batchId },
  });

  if (!batch) {
    throw new OrderError("BATCH_NOT_FOUND", "Batch not found.");
  }

  if (batch.status !== "OPEN") {
    throw new OrderError(
      "BATCH_NOT_OPEN",
      "This pre-order batch is not currently accepting orders."
    );
  }

  const now = new Date();
  if (batch.startAt && now < batch.startAt) {
    throw new OrderError(
      "BATCH_NOT_STARTED",
      "This pre-order batch has not started yet."
    );
  }
  if (batch.endAt && now > batch.endAt) {
    throw new OrderError(
      "BATCH_EXPIRED",
      "This pre-order batch has ended."
    );
  }

  // ── Step 3: Validate each item & calculate pricing ─────────
  const resolvedItems: {
    variantId: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    productName: string;
    variantSnapshot: object;
  }[] = [];

  for (const item of input.items) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: item.variantId, active: true },
      include: { product: true },
    });

    if (!variant) {
      throw new OrderError(
        "VARIANT_NOT_FOUND",
        `A selected product variant is unavailable or no longer exists.`
      );
    }

    const product = variant.product;

    if (!product.active) {
      throw new OrderError(
        "PRODUCT_INACTIVE",
        `"${product.name}" is no longer available.`
      );
    }

    if (!product.preorderEnabled) {
      throw new OrderError(
        "PRODUCT_NOT_PREORDER",
        `"${product.name}" is not available for pre-order.`
      );
    }

    if (product.preorderStatus !== "OPEN") {
      throw new OrderError(
        "PRODUCT_PREORDER_CLOSED",
        `"${product.name}" is no longer accepting pre-orders.`
      );
    }

    // Verify variant belongs to a batch product
    const batchProduct = await prisma.batchProduct.findUnique({
      where: {
        batchId_productId: {
          batchId: input.batchId,
          productId: product.id,
        },
      },
    });

    if (!batchProduct) {
      throw new OrderError(
        "PRODUCT_NOT_IN_BATCH",
        `"${product.name}" is not part of this batch.`
      );
    }

    // Use variant price override if set, otherwise product price
    const unitPrice = Number(variant.priceOverride ?? product.price);

    resolvedItems.push({
      variantId: variant.id,
      quantity: item.quantity,
      unitPrice,
      productId: product.id,
      productName: product.name,
      variantSnapshot: {
        size: variant.size,
        color: variant.color,
        sku: variant.sku,
      },
    });
  }

  // ── Step 4: Server-side price calculation ──────────────────
  const subtotal = resolvedItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );

  // ── Step 4b: Order total (no delivery fee: shipping is settled in Instagram DM) ─────────────────────
  const total = subtotal;

  // ── Step 5: Operator-defined answers removed ─────────────────
  // We only require full name and instagram handle.
  const customerFullName = input.customerInfo.fullName;
  const customerHandle = input.customerInfo.instagramHandle;

  // Typed as the JSON input Prisma expects
  const customerSnapshot: Prisma.InputJsonValue = {
    fullName: customerFullName,
    instagramHandle: customerHandle,
  };

  // ── Step 6: Duplicate detection ────────────────────────────
  // Keyed on the Instagram account: it is the identity, and it is already
  // normalised by the time it reaches here.
  const duplicateRef = await detectDuplicate(
    input.customerInfo.instagramHandle,
    input.batchId
  );

  // ── Step 8: ATOMIC TRANSACTION ─────────────────────────────
  // This is the critical section.
  // Capacity (and the product-level pre-order limit) is claimed by conditional
  // UPDATEs, never by read-then-write logic. Under Postgres READ COMMITTED a
  // conflicting UPDATE waits for the competing transaction, then re-evaluates
  // its own WHERE clause against the newly committed row — so two simultaneous
  // checkouts can never both claim the last unit. The previous
  // `findUnique` + `update` pair read stale rows and oversold the stock.
  // Prisma's default 2s wait for a pooled connection was too tight once a dozen
  // checkouts arrived at the same moment against a remote database: the checkout
  // failed with "Unable to start a transaction in the given time" even though
  // stock was available. Waiting longer is strictly better than refusing an
  // order that could have been accepted.
  const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 20_000 } as const;

  const writeOrder = (reference: string, accessToken: string) => prisma.$transaction(async (tx) => {
    for (const item of resolvedItems) {
      // Claim the variant capacity. `decrement` on a NULL column stays NULL,
      // so `remainingCapacity = null` means "unlimited" and is left alone.
      const variantClaim = await tx.productVariant.updateMany({
        where: {
          id: item.variantId,
          active: true,
          OR: [
            { remainingCapacity: null },
            { remainingCapacity: { gte: item.quantity } },
          ],
        },
        data: { remainingCapacity: { decrement: item.quantity } },
      });

      if (variantClaim.count !== 1) {
        // Separate "no longer available" from "sold out" so the customer gets
        // a message they can act on.
        const current = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          select: { active: true, remainingCapacity: true },
        });

        if (!current || !current.active) {
          throw new OrderError(
            "VARIANT_LOCKED_NOT_FOUND",
            "A selected product variant is no longer available."
          );
        }

        throw new OrderError(
          "INSUFFICIENT_CAPACITY",
          `Sorry, we don't have enough stock for your requested quantity. Please adjust and try again.`
        );
      }

      // Claim the product-level pre-order limit. Prisma cannot compare two
      // columns inside a `where` filter, so this is expressed as raw SQL.
      // `preorderLimit IS NULL` means "no limit".
      const productClaim = await tx.$executeRaw`
        UPDATE "products"
        SET "preorderReserved" = "preorderReserved" + ${item.quantity}
        WHERE "id" = ${item.productId}
          AND ("preorderLimit" IS NULL OR "preorderReserved" + ${item.quantity} <= "preorderLimit")
      `;

      if (productClaim !== 1) {
        throw new OrderError(
          "PRODUCT_CAPACITY_FULL",
          `"${item.productName}" has reached its pre-order limit.`
        );
      }
    }

    // Customer identity.
    //
    // Read-then-write rather than a blind upsert, for one reason: the read is how
    // "is this a new customer?" is answered, and that answer is recorded on the
    // order. Both branches target the unique `instagramHandle`, so two
    // simultaneous first orders from the same account converge on one row — the
    // loser of that race gets a P2002 and simply re-runs the transaction.
    //
    // The customer lives inside this transaction so a failed checkout (sold out,
    // say) cannot leave an orphan customer behind and inflate the regulars list
    // with someone who never actually ordered.
    const existingCustomer = await tx.customer.findUnique({
      where: { instagramHandle: customerHandle },
      select: { id: true },
    });

    const customer = existingCustomer
      ? await tx.customer.update({
          where: { id: existingCustomer.id },
          data: { fullName: customerFullName },
        })
      : await tx.customer.create({
          data: {
            fullName: customerFullName,
            instagramHandle: customerHandle,
          },
        });

    const newOrder = await tx.order.create({
      data: {
        reference,
        accessToken,
        batchId: input.batchId,
        customerId: customer.id,
        status: "PENDING",
        paymentStatus: "UNPAID",
        idempotencyKey: input.idempotencyKey,
        subtotal,
        total,
        customerSnapshot,
        isNewCustomer: !existingCustomer,
        isPossibleDuplicate: !!duplicateRef,
        duplicateOfRef: duplicateRef ?? null,
        items: {
          create: resolvedItems.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
            unitPriceAtPurchase: item.unitPrice,
            productNameSnapshot: item.productName,
            variantSnapshot: item.variantSnapshot,
          })),
        },
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: "PENDING",
            changedBy: "system",
            note: "Order created",
          },
        },
      },
    });

    // Audit log
    await tx.auditLog.create({
      data: {
        orderId: newOrder.id,
        actor: "customer",
        action: "order.created",
        newValue: { reference, total: total.toString() },
        metadata: {
          instagramHandle: customerHandle,
          isNewCustomer: !existingCustomer,
        },
      },
    });

    return newOrder;
  }, TRANSACTION_OPTIONS);

  // ── Step 8b: Persist with a collision-free reference ────────
  // The per-day reference is allocated optimistically. `orders.reference` is
  // UNIQUE, so a collision simply means "take the next number and try again".
  // Without this retry a race between two checkouts surfaced to the customer
  // as an unexplained server error.
  const MAX_REFERENCE_ATTEMPTS = 5;
  let order: Awaited<ReturnType<typeof writeOrder>> | undefined;

  for (let attempt = 1; attempt <= MAX_REFERENCE_ATTEMPTS; attempt += 1) {
    const reference = await generateOrderReference();

    try {
      // A fresh token per attempt: `orders.accessToken` is UNIQUE, so reusing one
      // across retries would turn a reference collision into a token collision.
      order = await writeOrder(reference, generateAccessToken());
      break;
    } catch (error) {
      // Two first-time orders from the same Instagram account at the same
      // instant: one of them loses the unique-index race on `customers`, and
      // re-running now finds the row the winner created.
      if (isCustomerCollision(error) && attempt < MAX_REFERENCE_ATTEMPTS) {
        continue;
      }

      if (isReferenceCollision(error) && attempt < MAX_REFERENCE_ATTEMPTS) {
        continue;
      }

      // The same form was submitted twice at the same instant: the idempotency
      // key lost the race, so return what the winning request created instead
      // of reporting a failure for an order that does exist.
      if (isIdempotencyCollision(error) && input.idempotencyKey) {
        const existing = await prisma.order.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          select: { reference: true, total: true, status: true, accessToken: true },
        });
        if (existing) return { idempotent: true, order: existing };
      }

      throw error;
    }
  }

  if (!order) {
    throw new OrderError(
      "ORDER_REFERENCE_CONFLICT",
      "We could not allocate an order number. Please try again."
    );
  }

  // No notifications are sent, by design. The operator works a single queue in
  // the admin panel, and the dashboard's action list is what surfaces an order
  // needing attention — a console no-op pretending to notify anyone was worse
  // than nothing at all.

  return {
    idempotent: false,
    order: {
      reference: order.reference,
      // The customer's own capability URL. Returned exactly once, here, and
      // never recoverable from the reference alone.
      accessToken: order.accessToken,
      total: total,
      status: order.status,
      isPossibleDuplicate: order.isPossibleDuplicate,
    },
  };
}
/**
 * Returns an order's reserved capacity to the pool.
 *
 * Without this, cancelling or rejecting an order consumes the stock it held
 * forever, and the storefront keeps showing those variants as sold out.
 *
 * Must run inside the same transaction as the status change so the two can
 * never drift apart. `CANCELLED` / `REJECTED` are terminal, so this runs at
 * most once per order.
 *
 * `increment` on a NULL column stays NULL, so variants with unlimited
 * capacity (`remainingCapacity = null`) are left untouched.
 */
export async function releaseOrderCapacity(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: {
      quantity: true,
      variantId: true,
      variant: { select: { productId: true } },
    },
  });

  for (const item of items) {
    await tx.productVariant.updateMany({
      where: { id: item.variantId },
      data: { remainingCapacity: { increment: item.quantity } },
    });

    // GREATEST stops preorderReserved from going negative if data ever drifts.
    await tx.$executeRaw`
      UPDATE "products"
      SET "preorderReserved" = GREATEST("preorderReserved" - ${item.quantity}, 0)
      WHERE "id" = ${item.variant.productId}
    `;
  }
}

