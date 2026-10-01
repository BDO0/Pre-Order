import { describe, expect, it } from "vitest";
import { CUSTOMER_STATUS_COPY, customerStatusCopy } from "@/lib/order-status-copy";

const ALL_ORDER_STATUSES = [
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
] as const;

describe("CUSTOMER_STATUS_COPY", () => {
  it("covers every status an order can be in", () => {
    for (const status of ALL_ORDER_STATUSES) {
      const copy = CUSTOMER_STATUS_COPY[status];
      expect(copy, `missing copy for ${status}`).toBeDefined();
      expect(copy.label.trim()).not.toBe("");
      expect(copy.detail.trim()).not.toBe("");
    }
  });

  it("never shows the customer an enum name", () => {
    for (const status of ALL_ORDER_STATUSES) {
      const copy = CUSTOMER_STATUS_COPY[status];
      expect(copy.label).not.toContain("_");
      expect(copy.detail).not.toContain("_");
    }
  });

  it("gives each status a distinct label", () => {
    const labels = ALL_ORDER_STATUSES.map((status) => CUSTOMER_STATUS_COPY[status].label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("marks exactly the statuses where the customer owes an action", () => {
    const awaiting = ALL_ORDER_STATUSES.filter(
      (status) => CUSTOMER_STATUS_COPY[status].awaitingCustomer
    );

    expect(awaiting).toEqual(["PENDING", "AWAITING_PAYMENT"]);
  });

  it("tells a completed order apart from a rejected one", () => {
    expect(CUSTOMER_STATUS_COPY.COMPLETED.detail).toMatch(/thank you/i);
    expect(CUSTOMER_STATUS_COPY.REJECTED.detail).toMatch(/Instagram/);
  });
});

describe("customerStatusCopy", () => {
  it("returns the authored copy for a known status", () => {
    expect(customerStatusCopy("CONFIRMED")).toEqual(CUSTOMER_STATUS_COPY.CONFIRMED);
  });

  it("degrades rather than throwing on a status this build does not know", () => {
    const copy = customerStatusCopy("AWAITING_COURIER");

    expect(copy.label).toBe("awaiting courier");
    expect(copy.detail).toContain("Instagram");
    expect(copy.awaitingCustomer).toBe(false);
  });

  it("never renders an empty label, whatever it is handed", () => {
    for (const value of ["", "   ", "unexpected"]) {
      expect(customerStatusCopy(value).label.length).toBeGreaterThan(0);
    }
  });
});
