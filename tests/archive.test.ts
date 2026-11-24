import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import {
  shouldAutoCloseOnArchive,
  shouldReleaseCapacityOnPermanentDelete,
} from "@/lib/order-service";
import { buildOrderWhere } from "@/lib/order-filters";
import { stripArchivedSlugSuffix } from "@/lib/batches";

describe("shouldAutoCloseOnArchive (B3 — intake-only auto-close policy)", () => {
  it("auto-closes unpaid intake statuses (PENDING, AWAITING_PAYMENT, PAYMENT_REVIEW)", () => {
    for (const status of ["PENDING", "AWAITING_PAYMENT", "PAYMENT_REVIEW"]) {
      expect(shouldAutoCloseOnArchive({ status, paymentStatus: "UNPAID" })).toBe(true);
    }
  });

  it("never auto-closes accepted, in-production, shipped, or completed orders even if unpaid", () => {
    for (const status of ["CONFIRMED", "PROCESSING", "READY", "SHIPPED", "COMPLETED"]) {
      expect(shouldAutoCloseOnArchive({ status, paymentStatus: "UNPAID" })).toBe(false);
    }
  });

  it("never auto-closes already PAID orders regardless of status", () => {
    for (const status of [
      "PENDING",
      "AWAITING_PAYMENT",
      "PAYMENT_REVIEW",
      "CONFIRMED",
      "PROCESSING",
      "READY",
      "SHIPPED",
      "COMPLETED",
    ]) {
      expect(shouldAutoCloseOnArchive({ status, paymentStatus: "PAID" })).toBe(false);
    }
  });
});

describe("shouldReleaseCapacityOnPermanentDelete (L1 — stock return policy)", () => {
  it("releases reserved capacity for pre-shipped active statuses", () => {
    for (const status of [
      "PENDING",
      "AWAITING_PAYMENT",
      "PAYMENT_REVIEW",
      "CONFIRMED",
      "PROCESSING",
      "READY",
    ]) {
      expect(shouldReleaseCapacityOnPermanentDelete(status)).toBe(true);
    }
  });

  it("does not return stock for already cancelled/rejected or already shipped/completed orders", () => {
    for (const status of ["CANCELLED", "REJECTED", "SHIPPED", "COMPLETED"]) {
      expect(shouldReleaseCapacityOnPermanentDelete(status)).toBe(false);
    }
  });
});

describe("buildOrderWhere archive filtering (B4 — CSV export vs active orders tab)", () => {
  it("defaults to active non-archived orders only", () => {
    const where = buildOrderWhere(new URLSearchParams());
    expect(where.archivedAt).toBeNull();
  });

  it("includes archived orders when includeArchived is true (used by CSV export)", () => {
    const where = buildOrderWhere(new URLSearchParams(), { includeArchived: true });
    expect("archivedAt" in where).toBe(false);
  });

  it("filters exclusively to archived orders when onlyArchived is true", () => {
    const where = buildOrderWhere(new URLSearchParams(), { onlyArchived: true });
    expect(where.archivedAt).toEqual({ not: null });
  });
});

describe("stripArchivedSlugSuffix", () => {
  it("strips the -archived-<id> suffix when restoring a batch or product", () => {
    expect(stripArchivedSlugSuffix("silk-abaya-archived-a1b2c3")).toBe("silk-abaya");
    expect(stripArchivedSlugSuffix("batch-1-october-archived-9f8e7d")).toBe("batch-1-october");
  });

  it("leaves non-archived slugs untouched", () => {
    expect(stripArchivedSlugSuffix("silk-abaya")).toBe("silk-abaya");
  });
});
