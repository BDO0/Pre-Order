import { prisma } from "@/lib/db";
import { generateOrderReference } from "@/lib/order-number";
import { detectDuplicate } from "@/lib/duplicate-detection";
import { notificationService } from "@/lib/notification-service";
import { getStoreSettings } from "@/lib/settings";
import { computeShippingFee } from "@/lib/pricing";
import { mimeTypeForKey } from "@/lib/uploads";
import type { OrderSubmission } from "@/lib/validation";
import type { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────

export class OrderError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "OrderError";
  }
}

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

// ─────────────────────────────────────────────────────────────
// ORDER SERVICE
// ─────────────────────────────────────────────────────────────

export async function createOrder(input: OrderSubmission) {
  // ── Step 1: Idempotency check ──────────────────────────────
  if (input.idempotencyKey) {
    const existing = await prisma.order.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { reference: true, total: true, status: true },
    });
    if (existing) {
      return { idempotent: true, order: existing };
    }
  }

  // ── Step 2: Validate campaign ──────────────────────────────
  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
  });

  if (!campaign) {
    throw new OrderError("CAMPAIGN_NOT_FOUND", "Campaign not found.");
  }

  if (campaign.status !== "OPEN") {
    throw new OrderError(
      "CAMPAIGN_NOT_OPEN",
      "This pre-order campaign is not currently accepting orders."
    );
  }

  const now = new Date();
  if (campaign.startAt && now < campaign.startAt) {
    throw new OrderError(
      "CAMPAIGN_NOT_STARTED",
      "This pre-order campaign has not started yet."
    );
  }
  if (campaign.endAt && now > campaign.endAt) {
    throw new OrderError(
      "CAMPAIGN_EXPIRED",
      "This pre-order campaign has ended."
    );
  }

  // ── Step 3: Validate payment method ───────────────────────
  const paymentMethod = await prisma.paymentMethod.findUnique({
    where: { id: input.paymentMethodId, active: true },
  });

  if (!paymentMethod) {
    throw new OrderError(
      "INVALID_PAYMENT_METHOD",
      "The selected payment method is not available."
    );
  }

  if (paymentMethod.requiresProof && !input.paymentProofKey) {
    throw new OrderError(
      "PROOF_REQUIRED",
      "Payment proof is required for the selected payment method."
    );
  }

  // ── Step 4: Validate each item & calculate pricing ────────
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

    // Verify variant belongs to a campaign product
    const campaignProduct = await prisma.campaignProduct.findUnique({
      where: {
        campaignId_productId: {
          campaignId: input.campaignId,
          productId: product.id,
        },
      },
    });

    if (!campaignProduct) {
      throw new OrderError(
        "PRODUCT_NOT_IN_CAMPAIGN",
        `"${product.name}" is not part of this campaign.`
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

  // ── Step 5: Server-side price calculation ──────────────────
  const subtotal = resolvedItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );

  // ── Step 5b: Delivery fee ──────────────────────────────────
  // Read from the settings table rather than a literal, through the same helper
  // that publishes /api/settings/public to the storefront — so the fee shown in
  // the cart and the fee charged here can never drift apart. Pickup is free.
  const storeSettings = await getStoreSettings();
  const shippingAmount = computeShippingFee({
    deliveryType: input.deliveryInfo.type,
    settings: storeSettings,
  });

  const total = subtotal + shippingAmount;

  // ── Step 6: Duplicate detection ────────────────────────────
  const duplicateRef = await detectDuplicate(
    input.customerInfo.mobileNumber,
    input.campaignId
  );

  // ── Step 7: Generate order reference ──────────────────────
  // The reference is NOT generated here: it can collide with a simultaneous
  // checkout, so it is (re)allocated inside the retry loop below.

  // ── Step 8: ATOMIC TRANSACTION ────────────────────────────
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

  const writeOrder = (reference: string) => prisma.$transaction(async (tx) => {
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

    // Upsert customer — safe pattern (avoid fake "new-customer" id collision)
    const existingCustomer = await tx.customer.findFirst({
      where: { mobileNumber: input.customerInfo.mobileNumber },
      select: { id: true },
    });

    let customer;
    if (existingCustomer) {
      customer = await tx.customer.update({
        where: { id: existingCustomer.id },
        data: {
          fullName: input.customerInfo.fullName,
          email: input.customerInfo.email || null,
        },
      });
    } else {
      customer = await tx.customer.create({
        data: {
          fullName: input.customerInfo.fullName,
          mobileNumber: input.customerInfo.mobileNumber,
          email: input.customerInfo.email || null,
          instagramHandle: input.customerInfo.instagramHandle || null,
          messengerName: input.customerInfo.messengerName || null,
        },
      });
    }


    // Create order
    const newOrder = await tx.order.create({
      data: {
        reference,
        campaignId: input.campaignId,
        customerId: customer.id,
        paymentMethodId: input.paymentMethodId,
        status: "PENDING",
        paymentStatus: "UNPAID",
        fulfillmentType:
          input.deliveryInfo.type === "DELIVERY" ? "DELIVERY" : "PICKUP",
        idempotencyKey: input.idempotencyKey,
        subtotal,
        shippingAmount,
        total,
        customerSnapshot: input.customerInfo,
        deliverySnapshot: input.deliveryInfo,
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

    // Record payment proof if provided
    if (input.paymentProofKey) {
      await tx.paymentProof.create({
        data: {
          orderId: newOrder.id,
          fileKey: input.paymentProofKey,
          // Derived from the stored key's extension. Uploads are re-encoded to
          // WebP, so hardcoding image/jpeg would mislabel every new proof.
          mimeType: mimeTypeForKey(input.paymentProofKey),
        },
      });
    }

    // Audit log
    await tx.auditLog.create({
      data: {
        orderId: newOrder.id,
        actor: "customer",
        action: "order.created",
        newValue: { reference, total: total.toString() },
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
      order = await writeOrder(reference);
      break;
    } catch (error) {
      if (isReferenceCollision(error) && attempt < MAX_REFERENCE_ATTEMPTS) {
        continue;
      }

      // The same form was submitted twice at the same instant: the idempotency
      // key lost the race, so return what the winning request created instead
      // of reporting a failure for an order that does exist.
      if (isIdempotencyCollision(error) && input.idempotencyKey) {
        const existing = await prisma.order.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          select: { reference: true, total: true, status: true },
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

  // ── Step 9: Send notifications (outside transaction) ───────
  await notificationService.send({
    type: "ORDER_CREATED",
    orderId: order.id,
    reference: order.reference,
    customerName: input.customerInfo.fullName,
    customerPhone: input.customerInfo.mobileNumber,
    customerEmail: input.customerInfo.email || undefined,
    total: total,
  });

  return {
    idempotent: false,
    order: {
      reference: order.reference,
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
