import { z } from "zod";
import { INSTAGRAM_HANDLE_HINT, normaliseInstagramHandle } from "@/lib/instagram";
import { MAX_ANSWER_LENGTH } from "@/lib/order-answers";
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
export const checkoutAnswerSchema = z.object({
  fieldId: z.string().trim().min(1, "Invalid question").max(60, "Invalid question"),
  value: z.string().max(MAX_ANSWER_LENGTH, "That answer is too long"),
});
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
export const paymentToggleSchema = z.object({
  paid: z.boolean(),
  note: z.string().max(500, "Note is too long").optional(),
});
export const internalNotesSchema = z.object({
  notes: z.string().max(2000, "Note is too long"),
});
export type PaymentToggleInput = z.infer<typeof paymentToggleSchema>;
export type InternalNotesInput = z.infer<typeof internalNotesSchema>;
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
const blankToNull = (value: string | null | undefined): string | null | undefined =>
  value === undefined ? undefined : value === "" ? null : value;
export const productVariantWriteSchema = productVariantSchema
  .pick({ size: true, color: true, capacity: true })
  .extend({
    size: z.string().trim().max(200, "That size is too long").optional().nullable().transform(blankToNull),
    color: z.string().trim().max(200, "That colour is too long").optional().nullable().transform(blankToNull),
  });
export const productVariantListSchema = z.array(productVariantWriteSchema).max(200);
export const productCreateSchema = productSchema.extend({
  images: z.array(z.string().max(1000)).max(10).optional(),
  variants: productVariantListSchema.optional(),
});
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
export const FORM_FIELD_TYPES = [
  "TEXT",
  "TEXTAREA",
  "PHONE",
  "EMAIL",
  "NUMBER",
  "SELECT",
] as const;
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
export const formFieldUpdateSchema = formFieldCreateSchema.omit({ key: true }).partial();
export const formFieldReorderSchema = z.object({
  order: z.array(z.string().min(1)).min(1).max(200),
});
const timestampField = z
  .union([
    z.string().datetime({ offset: true }),
    z.string().datetime(),
    z.literal(""),
    z.null(),
  ])
  .optional();
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
  notes: z.string().max(4000, "That description is too long").optional().nullable(),
  status: z.enum(["DRAFT", "SCHEDULED", "OPEN", "CLOSED", "ARCHIVED"]).optional(),
  startAt: timestampField,
  endAt: timestampField,
  etaAt: timestampField,
  coverImage: z.string().max(1000, "That image path is too long").optional().nullable(),
  productIds: z.array(z.string().min(1)).max(500).optional(),
});
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
