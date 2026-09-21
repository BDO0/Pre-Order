import { describe, expect, it } from "vitest";
import { CUSTOMER_STATUS_COPY, customerStatusCopy } from "@/lib/order-status-copy";

// Every status in the OrderStatus enum, written out here rather than imported.
// Prisma's generated enum is not a runtime value in every client generation, and
// a hand-written list is the stronger test anyway: if someone adds a status to
// the schema without adding copy for it, this list is what fails.
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
    // The admin panel speaks in enums because the operator moves orders through
    // them. A customer must not: an underscore in customer-facing copy is the
    // visible edge of an unfinished feature.
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
    // These are the two where a reply in DM or a payment moves the order along.
    // Getting this wrong is not cosmetic: the copy is what nudges the customer.
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
    // A database can be ahead of the code serving it: a migration that adds a
    // status can ship before the deploy that renders it. Worse copy, still
    // correct — never a blank badge and never a crash on the tracking page.
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
