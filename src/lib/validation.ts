import { z } from "zod";
import { INSTAGRAM_HANDLE_HINT, normaliseInstagramHandle } from "@/lib/instagram";
import { MAX_ANSWER_LENGTH } from "@/lib/order-answers";

/**
 * The checkout form asks for exactly two things: a full name (so the operator
 * knows who is talking) and an Instagram account (so the operator can actually
 * reach them). Everything else — payment, address, sizing, colour — is settled
 * in DM and is captured, if it is captured at all, by an operator-defined field
 * (see OrderFormField).
 */

/** A pasted handle is normalised before it is judged, never rejected for shape. */
export const instagramHandleSchema = z
  .string()
  .min(1, "Your Instagram username is required")
  .transform((value, ctx) => {
    const handle = normaliseInstagramHandle(value);
    if (!handle) {
      ctx.addIssue({ code: "custom", message: INSTAGRAM_HANDLE_HINT });
      return z.NEVER;
    }
    return handle;
  });

export const customerInfoSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Full name is required")
    .max(120, "That name is too long"),
  instagramHandle: instagramHandleSchema,
});

export const orderItemSchema = z.object({
  variantId: z.string().min(1, "Invalid variant"),
  quantity: z.number().int().min(1, "Quantity must be at least 1").max(100),
});

/**
 * One answer to one operator-defined question.
 *
 * `fieldId` carries the field's `key`, not its row id: the key is what a stored
 * snapshot names, and it is what survives a question being recreated. The value
 * is only checked here for being a string of a sane length — the rules that need
 * the field definition itself (required, email shape, "one of the listed
 * options") live in `buildSnapshotAnswers`, which is the one place that holds
 * both halves and can therefore judge them.
 */
export const checkoutAnswerSchema = z.object({
  fieldId: z.string().trim().min(1, "Invalid question").max(60, "Invalid question"),
  value: z.string().max(MAX_ANSWER_LENGTH, "That answer is too long"),
});

/** Most questions one order may carry an answer for. */
const MAX_ANSWERS = 50;

export const orderSubmissionSchema = z.object({
  idempotencyKey: z.string().uuid("Invalid idempotency key"),
  batchId: z.string().min(1, "Invalid batch"),
  items: z.array(orderItemSchema).min(1, "At least one item is required"),
  customerInfo: customerInfoSchema,
  answers: z.array(checkoutAnswerSchema).max(MAX_ANSWERS, "Too many answers").default([]),
});

export const orderLookupSchema = z.object({
  reference: z.string().trim().min(1, "Order reference is required"),
  instagramHandle: z.string().min(1, "Instagram username is required"),
});


export const orderStatusUpdateSchema = z.object({
  status: z.enum([
    "PENDING",
    "AWAITING_PAYMENT",
    "PAYMENT_REVIEW",
    "CONFIRMED",
    "PROCESSING",
    "READY",
    "SHIPPED",
    "COMPLETED",
    "CANCELLED",
    "REJECTED",
  ]),
  note: z.string().optional(),
});

/**
 * The whole payment model: an admin records that money has or has not arrived.
 *
 * There is no proof to approve and no provider to call — payment happens in
 * Instagram DM — so an explicit boolean is more honest than an action verb, and
 * an idempotent one: sending `paid: true` twice is not an error.
 */
export const paymentToggleSchema = z.object({
  paid: z.boolean(),
  note: z.string().max(500, "Note is too long").optional(),
});

export const internalNotesSchema = z.object({
  notes: z.string().max(2000, "Note is too long"),
});

export type PaymentToggleInput = z.infer<typeof paymentToggleSchema>;
export type InternalNotesInput = z.infer<typeof internalNotesSchema>;

/** Every pre-order state a product may be in. */
export const PREORDER_STATUSES = ["OPEN", "COMING_SOON", "CLOSED", "SOLD_OUT", "DISABLED"] as const;

export const productSchema = z.object({
  name: z.string().min(2, "Product name is required"),
  slug: z.string().regex(/^[a-z0-9-]+$/, "Slug must be URL-safe (lowercase, hyphens)"),
  description: z.string().optional(),
  price: z.number().positive("Price must be positive"),
  currency: z.string().default("PHP"),
  category: z.string().optional(),
  preorderEnabled: z.boolean().default(false),
  preorderStatus: z.enum(PREORDER_STATUSES).default("DISABLED"),
  preorderStartAt: z.string().datetime().optional().nullable(),
  preorderEndAt: z.string().datetime().optional().nullable(),
  preorderLimit: z.number().int().positive().optional().nullable(),
});

export const productVariantSchema = z.object({
  size: z.string().optional(),
  color: z.string().optional(),
  sku: z.string().optional(),
  priceOverride: z.number().positive().optional().nullable(),
  capacity: z.number().int().positive().optional().nullable(),
});

/**
 * A text column where a blank string and `null` say the same thing.
 *
 * A form sends `""` for a field the operator emptied; the database stores `null`
 * for "no value". Collapsing the two here means no write path has to remember
 * which spelling a column prefers, and an emptied field can never be stored as a
 * size that renders as an empty row on the storefront.
 */
const blankToNull = (value: string | null | undefined): string | null | undefined =>
  value === undefined ? undefined : value === "" ? null : value;

/**
 * The variant fields the product screens manage, and nothing else.
 *
 * Narrowed from `productVariantSchema` so the two can never describe the same row
 * differently, but restricted to the columns this write path honours: `sku` and
 * `priceOverride` are deliberately absent. No screen edits them, and a key that is
 * not in the schema cannot be sent - so a save cannot blank a column it does not
 * manage, which is a failure this codebase has already paid for once, with
 * batches (`description: description || null`).
 */
export const productVariantWriteSchema = productVariantSchema
  .pick({ size: true, color: true, capacity: true })
  .extend({
    size: z.string().trim().max(200, "That size is too long").optional().nullable().transform(blankToNull),
    color: z.string().trim().max(200, "That colour is too long").optional().nullable().transform(blankToNull),
  });

/**
 * A whole variant list, which is authoritative when it is sent.
 *
 * An empty array is a real instruction - "this product has no sizes any more" -
 * and is treated as one. Leaving the key out is the different instruction "the
 * variants are not what this screen is editing", and leaves them alone.
 */
export const productVariantListSchema = z.array(productVariantWriteSchema).max(200);

/** Creating a product: the product's own fields plus its initial variants. */
export const productCreateSchema = productSchema.extend({
  images: z.array(z.string().max(1000)).max(10).optional(),
  variants: productVariantListSchema.optional(),
});

/**
 * Editing a product, from the screen that exists.
 *
 * Only the fields that screen manages: it cannot set the slug, the description
 * or the pre-order window, so those keys are not accepted rather than accepted
 * and then ignored.
 *
 * `preorderLimit` used to be on that list, because no screen had a box for it -
 * which meant the cap was only ever set by `prisma/seed.ts`, and a product an
 * operator created was unlimited no matter what the product form said. Now that
 * both product screens send it, it is accepted, and taken from `productSchema`
 * rather than retyped so the create and edit paths cannot come to disagree about
 * what a valid limit is.
 */
export const productUpdateSchema = z.object({
  name: z.string().trim().min(2, "Product name is required"),
  price: z.coerce.number().positive("Valid price is required"),
  category: z.string().trim().max(120, "That category is too long").optional().nullable().transform(blankToNull),
  active: z.boolean().optional(),
  preorderStatus: z.enum(PREORDER_STATUSES).optional(),
  preorderLimit: productSchema.shape.preorderLimit,
  images: z.array(z.string().max(1000)).max(10).optional(),
  variants: productVariantListSchema.optional(),
});

/**
 * Every field type the checkout form can ask for.
 *
 * Shared with the admin screen so the two cannot drift: a type the UI offers and
 * the API refuses (or the reverse) is a bug that only shows up in production.
 */
export const FORM_FIELD_TYPES = [
  "TEXT",
  "TEXTAREA",
  "PHONE",
  "EMAIL",
  "NUMBER",
  "SELECT",
] as const;

/**
 * Creating a checkout question.
 *
 * `type` was previously cast rather than checked, so any truthy string reached
 * Prisma and came back as a 500 for what is a bad request. The lengths are here
 * because these strings are rendered on the checkout form and stored on every
 * order that carries an answer.
 */
export const formFieldCreateSchema = z.object({
  key: z.string().trim().min(1, "Field key is required").max(60, "That key is too long"),
  label: z.string().trim().min(1, "Field label is required").max(120, "That label is too long"),
  type: z.enum(FORM_FIELD_TYPES).default("TEXT"),
  placeholder: z.string().trim().max(200, "That placeholder is too long").optional().nullable(),
  helpText: z.string().trim().max(500, "That help text is too long").optional().nullable(),
  required: z.boolean().default(false),
  sensitive: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  active: z.boolean().optional(),
});

/**
 * Editing one question.
 *
 * The key is not editable: it is how an answer recorded yesterday still points at
 * the question that asked it. Every other key is optional, and only the keys that
 * are present are written.
 */
export const formFieldUpdateSchema = formFieldCreateSchema.omit({ key: true }).partial();

/** A new order for the questions. */
export const formFieldReorderSchema = z.object({
  order: z.array(z.string().min(1)).min(1).max(200),
});

/**
 * A date-time written by a human into a `datetime-local` field.
 *
 * Three shapes all arrive from the admin screens and all three mean "no date":
 * a full ISO instant, `""` (what a browser sends for a field the operator just
 * emptied) and `null` (what our own forms send for "cleared"). `parseEta` in
 * `@/lib/batches` turns each of them into the `null` Prisma must store rather
 * than an Invalid Date. A malformed date is still rejected here, so a typo can
 * never quietly erase a stored ETA.
 */
const timestampField = z
  .union([
    z.string().datetime({ offset: true }),
    z.string().datetime(),
    z.literal(""),
    z.null(),
  ])
  .optional();

/**
 * Everything the admin screens may write for a batch.
 *
 * The screens say `notes` and `etaAt`; the database says `description` and
 * `endAt`. Both spellings are accepted and translated in exactly one place
 * (`normaliseBatchWrite` in `@/lib/batch-service`) instead of every route
 * choosing a side. A form should be free to speak the operator's vocabulary,
 * and a route should not have to know which screen called it.
 *
 * `slug` is optional because it is derived from the name when it is absent: a
 * URL-safe identifier is the server's job, and requiring one from the client is
 * precisely what made "create a batch" fail with a 400 for every submission.
 */
export const batchWriteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Batch name is required")
    .max(120, "That name is too long"),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, "Slug must be URL-safe (lowercase, hyphens)")
    .optional(),
  description: z
    .string()
    .max(4000, "That description is too long")
    .optional()
    .nullable(),
  /** Alias of `description`. */
  notes: z.string().max(4000, "That description is too long").optional().nullable(),
  status: z.enum(["DRAFT", "SCHEDULED", "OPEN", "CLOSED", "ARCHIVED"]).optional(),
  startAt: timestampField,
  endAt: timestampField,
  /** Alias of `endAt`: the date the operator promises the run lands. */
  etaAt: timestampField,
  coverImage: z.string().max(1000, "That image path is too long").optional().nullable(),
  productIds: z.array(z.string().min(1)).max(500).optional(),
});

/**
 * A partial write.
 *
 * Presence is what decides what changes — a key that was not sent is a field the
 * screen does not manage, not a field to clear. That distinction is the whole
 * difference between "rename this batch" and "rename this batch and also delete
 * its ETA, its cover image and its description".
 */
export const batchUpdateSchema = batchWriteSchema.partial();

export type BatchWriteInput = z.infer<typeof batchWriteSchema>;
export type BatchUpdateInput = z.infer<typeof batchUpdateSchema>;


export const adminLoginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export type CustomerInfo = z.infer<typeof customerInfoSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;
export type OrderSubmission = z.infer<typeof orderSubmissionSchema>;
export type OrderLookup = z.infer<typeof orderLookupSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type ProductVariantInput = z.infer<typeof productVariantSchema>;
