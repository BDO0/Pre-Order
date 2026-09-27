import { describe, expect, it } from "vitest";
import { isValidStatusTransition } from "@/lib/order-state-machine";
import type { OrderStatus } from "@prisma/client";

describe("confirm-and-pay transitions", () => {
  it("allows confirmation from initial intake statuses", () => {
    const validIntake: OrderStatus[] = ["PENDING", "AWAITING_PAYMENT", "PAYMENT_REVIEW"];
    for (const status of validIntake) {
      expect(isValidStatusTransition(status, "CONFIRMED")).toBe(true);
    }
  });

  it("does not allow confirmation from terminal or voided statuses", () => {
    const invalidStatuses: OrderStatus[] = ["CANCELLED", "REJECTED", "COMPLETED", "PROCESSING", "READY", "SHIPPED"];
    for (const status of invalidStatuses) {
      expect(isValidStatusTransition(status, "CONFIRMED")).toBe(false);
    }
  });
});
