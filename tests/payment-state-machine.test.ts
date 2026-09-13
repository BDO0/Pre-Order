import { describe, expect, it } from "vitest";
import {
  PAYMENT_ACTIONS,
  allowedPaymentActions,
  applyPaymentAction,
  isValidPaymentAction,
  type PaymentAction,
} from "@/lib/payment-state-machine";
import type { PaymentStatus } from "@prisma/client";

const ALL_ACTIONS: PaymentAction[] = ["VERIFY", "REJECT", "REFUND"];

describe("payment state machine", () => {
  it("describes every action it exposes", () => {
    for (const action of ALL_ACTIONS) {
      const rule = PAYMENT_ACTIONS[action];
      expect(rule.from.length).toBeGreaterThan(0);
      expect(rule.label.length).toBeGreaterThan(0);
      expect(rule.hint.length).toBeGreaterThan(0);
    }
  });

  it("offers only verification for an unpaid order", () => {
    expect(allowedPaymentActions("UNPAID")).toEqual(["VERIFY"]);
  });

  it("allows verifying or rejecting a proof under review", () => {
    expect(allowedPaymentActions("PENDING_REVIEW").sort()).toEqual([
      "REJECT",
      "VERIFY",
    ]);
  });

  it("allows refunding a paid order and nothing else", () => {
    expect(allowedPaymentActions("PAID")).toEqual(["REFUND"]);
  });

  it("offers no actions once the money is refunded", () => {
    expect(allowedPaymentActions("REFUNDED")).toEqual([]);
  });

  it("moves a payment to the status the action implies", () => {
    expect(applyPaymentAction("UNPAID", "VERIFY")).toBe("PAID");
    expect(applyPaymentAction("PENDING_REVIEW", "VERIFY")).toBe("PAID");
    expect(applyPaymentAction("PENDING_REVIEW", "REJECT")).toBe("UNPAID");
    expect(applyPaymentAction("PAID", "REFUND")).toBe("REFUNDED");
  });

  it("refuses to un-receive money that was already recorded as paid", () => {
    // REJECT exists to bounce a proof, not to undo a completed verification:
    // only an explicit REFUND may move a PAID payment.
    expect(isValidPaymentAction("PAID", "REJECT")).toBe(false);
    expect(() => applyPaymentAction("PAID", "REJECT")).toThrow(
      /PAYMENT_INVALID_ACTION/
    );
  });

  it("refuses to refund an order that was never paid", () => {
    expect(() => applyPaymentAction("UNPAID", "REFUND")).toThrow(
      /PAYMENT_INVALID_ACTION/
    );
    expect(() => applyPaymentAction("PENDING_REVIEW", "REFUND")).toThrow(
      /PAYMENT_INVALID_ACTION/
    );
  });

  it("refuses every action from a terminal refunded status", () => {
    for (const action of ALL_ACTIONS) {
      expect(() => applyPaymentAction("REFUNDED", action)).toThrow(
        /PAYMENT_INVALID_ACTION/
      );
    }
  });

  it("agrees with itself: anything offered can actually be applied", () => {
    const statuses: PaymentStatus[] = [
      "UNPAID",
      "PENDING_REVIEW",
      "PAID",
      "REFUNDED",
    ];

    for (const status of statuses) {
      for (const action of allowedPaymentActions(status)) {
        expect(() => applyPaymentAction(status, action)).not.toThrow();
      }
    }
  });
});
