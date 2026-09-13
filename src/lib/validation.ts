import { z } from "zod";

// ─────────────────────────────────────────────────────────────
// CUSTOMER INFO
// ─────────────────────────────────────────────────────────────
export const customerInfoSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  mobileNumber: z
    .string()
    .min(10, "Enter a valid mobile number")
    .regex(/^(\+63|0)9\d{9}$/, "Enter a valid PH mobile number (e.g. 09XXXXXXXXX)"),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  instagramHandle: z.string().optional(),
  messengerName: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────
// DELIVERY INFO
// ─────────────────────────────────────────────────────────────
export const deliveryInfoSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("DELIVERY"),
    recipientName: z.string().min(2, "Recipient name is required"),
    phoneNumber: z.string().min(10, "Phone number is required"),
    address: z.string().min(5, "Address is required"),
    city: z.string().min(2, "City is required"),
    province: z.string().min(2, "Province is required"),
    postalCode: z.string().optional(),
    additionalInstructions: z.string().optional(),
  }),
  z.object({
    type: z.literal("PICKUP"),
    pickupNote: z.string().optional(),
  }),
]);

// ─────────────────────────────────────────────────────────────
// ORDER ITEM
// ─────────────────────────────────────────────────────────────
export const orderItemSchema = z.object({
  // Existence, not format: seeded variant ids are `{productId}-{colour}-{size}`
  // and were rejected by `z.cuid()` even though the row exists.
  variantId: z.string().min(1, "Invalid variant"),
  quantity: z.number().int().min(1, "Quantity must be at least 1").max(100),
});

// ─────────────────────────────────────────────────────────────
// ORDER SUBMISSION
// ─────────────────────────────────────────────────────────────
export const orderSubmissionSchema = z.object({
  idempotencyKey: z.string().uuid("Invalid idempotency key"),
  // IDs are validated for EXISTENCE in the service layer (a missing row is
  // reported as CAMPAIGN_NOT_FOUND / INVALID_PAYMENT_METHOD); they must not be
  // format-checked here. The seed uses deterministic ids such as "pm-gcash",
  // which `z.cuid()` rejected, so the seeded catalogue could not be ordered at
  // all.
  campaignId: z.string().min(1, "Invalid campaign"),
  paymentMethodId: z.string().min(1, "Invalid payment method"),
  items: z.array(orderItemSchema).min(1, "At least one item is required"),
  customerInfo: customerInfoSchema,
  deliveryInfo: deliveryInfoSchema,
  paymentProofKey: z.string().optional(), // storage key after upload
});

// ─────────────────────────────────────────────────────────────
// ORDER STATUS LOOKUP (public)
// ─────────────────────────────────────────────────────────────
export const orderLookupSchema = z.object({
  reference: z.string().min(1, "Order reference is required"),
  mobileNumber: z
    .string()
    .min(10, "Mobile number is required"),
});

// ─────────────────────────────────────────────────────────────
// ADMIN: STATUS UPDATE
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// ADMIN: PAYMENT VERIFICATION
// ─────────────────────────────────────────────────────────────
export const paymentActionSchema = z.object({
  action: z.enum(["VERIFY", "REJECT", "REFUND"]),
  // Optional context for the audit trail ("proof matches BPI transfer").
  note: z.string().max(500, "Note is too long").optional(),
});

// ─────────────────────────────────────────────────────────────
// ADMIN: INTERNAL NOTES
// ─────────────────────────────────────────────────────────────
export const internalNotesSchema = z.object({
  // Empty string is allowed and clears the note: staff need a way to undo.
  notes: z.string().max(2000, "Note is too long"),
});

// ─────────────────────────────────────────────────────────────
// ADMIN: STORE SETTINGS
// ─────────────────────────────────────────────────────────────
export const settingsUpdateSchema = z
  .object({
    // coerce: the settings form submits an <input type="number"> value, which
    // arrives as a string in JSON.
    shippingFee: z.coerce
      .number()
      .min(0, "Fee cannot be negative")
      .max(100_000, "Fee is unreasonably high")
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No settings provided",
  });

export type PaymentActionInput = z.infer<typeof paymentActionSchema>;
export type InternalNotesInput = z.infer<typeof internalNotesSchema>;
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

// ─────────────────────────────────────────────────────────────
// PRODUCT
// ─────────────────────────────────────────────────────────────
export const productSchema = z.object({
  name: z.string().min(2, "Product name is required"),
  slug: z.string().regex(/^[a-z0-9-]+$/, "Slug must be URL-safe (lowercase, hyphens)"),
  description: z.string().optional(),
  price: z.number().positive("Price must be positive"),
  currency: z.string().default("PHP"),
  category: z.string().optional(),
  preorderEnabled: z.boolean().default(false),
  preorderStatus: z
    .enum(["OPEN", "COMING_SOON", "CLOSED", "SOLD_OUT", "DISABLED"])
    .default("DISABLED"),
  preorderStartAt: z.string().datetime().optional().nullable(),
  preorderEndAt: z.string().datetime().optional().nullable(),
  preorderLimit: z.number().int().positive().optional().nullable(),
});

// ─────────────────────────────────────────────────────────────
// PRODUCT VARIANT
// ─────────────────────────────────────────────────────────────
export const productVariantSchema = z.object({
  size: z.string().optional(),
  color: z.string().optional(),
  sku: z.string().optional(),
  priceOverride: z.number().positive().optional().nullable(),
  capacity: z.number().int().positive().optional().nullable(),
});

// ─────────────────────────────────────────────────────────────
// CAMPAIGN
// ─────────────────────────────────────────────────────────────
export const campaignSchema = z.object({
  name: z.string().min(2, "Campaign name is required"),
  slug: z.string().regex(/^[a-z0-9-]+$/, "Slug must be URL-safe (lowercase, hyphens)"),
  description: z.string().optional(),
  status: z
    .enum(["DRAFT", "SCHEDULED", "OPEN", "CLOSED", "ARCHIVED"])
    .default("DRAFT"),
  startAt: z.string().datetime().optional().nullable(),
  endAt: z.string().datetime().optional().nullable(),
});

// ─────────────────────────────────────────────────────────────
// PAYMENT METHOD
// ─────────────────────────────────────────────────────────────
export const paymentMethodSchema = z.object({
  name: z.string().min(1, "Name is required"),
  instructions: z.string().optional(),
  accountName: z.string().optional(),
  accountNumber: z.string().optional(),
  requiresProof: z.boolean().default(true),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

// ─────────────────────────────────────────────────────────────
// ADMIN LOGIN
// ─────────────────────────────────────────────────────────────
export const adminLoginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export type CustomerInfo = z.infer<typeof customerInfoSchema>;
export type DeliveryInfo = z.infer<typeof deliveryInfoSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;
export type OrderSubmission = z.infer<typeof orderSubmissionSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type ProductVariantInput = z.infer<typeof productVariantSchema>;
export type CampaignInput = z.infer<typeof campaignSchema>;
export type PaymentMethodInput = z.infer<typeof paymentMethodSchema>;
