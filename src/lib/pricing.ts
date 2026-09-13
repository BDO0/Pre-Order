/**
 * Pricing rules — pure data, safe to import from client components.
 *
 * The delivery fee used to be the literal `150` in three places (order service,
 * cart, checkout). It is now data: the server reads it from the `settings`
 * table and the storefront reads the same value from `/api/settings/public`, so
 * a price change can never be half-applied to just one of them.
 */

/** Fallback used when no `settings` row exists (matches the V1 flat rate). */
export const DEFAULT_SHIPPING_FEE = 150;

export type DeliveryType = "DELIVERY" | "PICKUP";

/** Keys of the `settings` table this application knows how to read. */
export const SETTING_KEYS = {
  shippingFee: "pricing.shipping_fee",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** Store-wide configuration as the app consumes it. */
export interface StoreSettings {
  /** Flat fee in PHP charged on DELIVERY orders. 0 disables the fee. */
  shippingFee: number;
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  shippingFee: DEFAULT_SHIPPING_FEE,
};

/**
 * Coerces any stored value into a usable fee.
 *
 * A settings row can hold anything (it is JSONB), so a hand-edited `"150"`,
 * `null` or `-5` must not reach a customer's total. Anything unusable falls back
 * to the default rather than to NaN, which would poison the whole total.
 */
export function normaliseShippingFee(value: unknown): number {
  const numeric =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;

  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric < 0) {
    return DEFAULT_SHIPPING_FEE;
  }

  // Two decimals: the column is DECIMAL(10,2).
  return Math.round(numeric * 100) / 100;
}

/**
 * The fee actually charged for an order.
 *
 * Pickup is always free — only DELIVERY carries a fee. Kept here (not in the
 * order service) so the cart, the checkout summary and the server all answer
 * with the same number.
 */
export function computeShippingFee(input: {
  deliveryType: DeliveryType;
  settings?: Pick<StoreSettings, "shippingFee">;
}): number {
  if (input.deliveryType !== "DELIVERY") return 0;
  return normaliseShippingFee(
    input.settings?.shippingFee ?? DEFAULT_STORE_SETTINGS.shippingFee
  );
}
