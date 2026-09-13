import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHIPPING_FEE,
  computeShippingFee,
  normaliseShippingFee,
} from "@/lib/pricing";

// The delivery fee used to be the literal 150 in three files. These tests pin
// down the coercion rules that keep a hand-edited settings row from producing a
// wrong — or NaN — total for a customer.
describe("normaliseShippingFee", () => {
  it("keeps a normal fee as-is", () => {
    expect(normaliseShippingFee(150)).toBe(150);
    expect(normaliseShippingFee(0)).toBe(0);
    expect(normaliseShippingFee(99.5)).toBe(99.5);
  });

  it("accepts a numeric string, because JSONB can hold one", () => {
    expect(normaliseShippingFee("150")).toBe(150);
    expect(normaliseShippingFee("  250.75 ")).toBe(250.75);
  });

  it("rounds to the two decimals the column stores", () => {
    expect(normaliseShippingFee(149.999)).toBe(150);
    expect(normaliseShippingFee(100.005)).toBe(100.01);
  });

  it("falls back to the default for anything unusable", () => {
    for (const value of [null, undefined, "", "free", NaN, Infinity, -1, {}, []]) {
      expect(normaliseShippingFee(value)).toBe(DEFAULT_SHIPPING_FEE);
    }
  });

  it("treats zero as a real choice, not as a missing value", () => {
    // "Free delivery" must survive: 0 is falsy, so a naive `value || default`
    // would silently re-impose the standard fee.
    expect(normaliseShippingFee(0)).toBe(0);
  });
});

describe("computeShippingFee", () => {
  it("charges nothing for store pickup, whatever the delivery fee is", () => {
    expect(
      computeShippingFee({ deliveryType: "PICKUP", settings: { shippingFee: 250 } })
    ).toBe(0);
  });

  it("charges the configured fee for delivery", () => {
    expect(
      computeShippingFee({ deliveryType: "DELIVERY", settings: { shippingFee: 250 } })
    ).toBe(250);
  });

  it("supports an operator setting the delivery fee to zero", () => {
    expect(
      computeShippingFee({ deliveryType: "DELIVERY", settings: { shippingFee: 0 } })
    ).toBe(0);
  });

  it("uses the application default when settings are unavailable", () => {
    expect(computeShippingFee({ deliveryType: "DELIVERY" })).toBe(
      DEFAULT_SHIPPING_FEE
    );
    expect(
      computeShippingFee({
        deliveryType: "DELIVERY",
        settings: { shippingFee: NaN },
      })
    ).toBe(DEFAULT_SHIPPING_FEE);
  });
});
