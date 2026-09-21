import { describe, expect, it } from "vitest";
import {
  PAYMENT_TOGGLES,
  isPaid,
  isPaymentChange,
  statusForPaid,
  toggleFor,
} from "@/lib/payment-state-machine";
import type { PaymentStatus } from "@prisma/client";

const ALL_STATUSES: PaymentStatus[] = ["UNPAID", "PAID"];

// The payment model is one boolean owned by the operator. These tests pin the
// two properties that matter: the mapping is total (a `paid` value always lands
// on a real status), and asking for the state an order is already in is never a
// state change — so a double-tap cannot write a fake audit entry.
describe("payment toggle", () => {
  it("maps a boolean onto the only two statuses that exist", () => {
    expect(statusForPaid(true)).toBe("PAID");
    expect(statusForPaid(false)).toBe("UNPAID");
  });

  it("describes every toggle it exposes", () => {
    for (const toggle of Object.values(PAYMENT_TOGGLES)) {
      expect(toggle.label.length).toBeGreaterThan(0);
      expect(toggle.hint.length).toBeGreaterThan(0);
      expect(toggle.action).toMatch(/^MARK_(PAID|UNPAID)$/);
    }
  });

  it("asks for the toggle that matches the target, not the current status", () => {
    expect(toggleFor(true).to).toBe("PAID");
    expect(toggleFor(false).to).toBe("UNPAID");
  });

  it("is idempotent: asking for the current state is not a change", () => {
    expect(isPaymentChange("UNPAID", false)).toBe(false);
    expect(isPaymentChange("PAID", true)).toBe(false);
  });

  it("reports a change only when the status actually moves", () => {
    expect(isPaymentChange("UNPAID", true)).toBe(true);
    expect(isPaymentChange("PAID", false)).toBe(true);
  });

  it("treats an un-verifying toggle as a legal correction", () => {
    // Marking a paid order unpaid again is how a mistake or a returned payment
    // is recorded. The old action model required an explicit REFUND for this.
    expect(statusForPaid(false)).toBe("UNPAID");
    expect(isPaid("PAID")).toBe(true);
    expect(isPaid("UNPAID")).toBe(false);
  });

  it("agrees with itself for every status", () => {
    for (const status of ALL_STATUSES) {
      const targetIsPaid = isPaid(status);
      // Requesting exactly what the order already is must never count as change.
      expect(isPaymentChange(status, targetIsPaid)).toBe(false);
      // Requesting the opposite must always count as change.
      expect(isPaymentChange(status, !targetIsPaid)).toBe(true);
    }
  });
});

