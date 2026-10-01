import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  hasPermission,
  isKnownRole,
  permissionsFor,
  type Permission,
} from "@/lib/permissions";
import type { AdminRole } from "@prisma/client";

const SCHEMA_ROLES: AdminRole[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "ORDER_MANAGER",
  "PRODUCT_MANAGER",
  "VIEWER",
];

const WRITE_PERMISSIONS: Permission[] = [
  "orders.update",
  "payments.verify",
  "products.write",
  "batches.write",
  "settings.write",
];

describe("permission matrix", () => {
  it("grants SUPER_ADMIN every permission", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission("SUPER_ADMIN", permission)).toBe(true);
    }
  });

  it("knows exactly the roles the schema declares", () => {
    for (const role of SCHEMA_ROLES) {
      expect(isKnownRole(role)).toBe(true);
    }
    expect(isKnownRole("SUPERUSER")).toBe(false);
    expect(isKnownRole("admin")).toBe(false);
  });

  it("denies everything when the role is missing, blank or unrecognised", () => {
    const unknownRoles: (string | null | undefined)[] = [
      null,
      undefined,
      "",
      "admin",
      "SUPERUSER",
      "ADMINISTRATOR",
    ];

    for (const role of unknownRoles) {
      for (const permission of ALL_PERMISSIONS) {
        expect(hasPermission(role, permission)).toBe(false);
      }
      expect(permissionsFor(role)).toEqual([]);
    }
  });

  it("keeps VIEWER strictly read-only", () => {
    for (const permission of WRITE_PERMISSIONS) {
      expect(hasPermission("VIEWER", permission)).toBe(false);
    }
    expect(hasPermission("VIEWER", "orders.read")).toBe(true);
    expect(hasPermission("VIEWER", "reports.read")).toBe(true);
  });

  it("does not let ORDER_MANAGER touch the catalogue or store settings", () => {
    expect(hasPermission("ORDER_MANAGER", "orders.update")).toBe(true);
    expect(hasPermission("ORDER_MANAGER", "payments.verify")).toBe(true);
    expect(hasPermission("ORDER_MANAGER", "products.write")).toBe(false);
    expect(hasPermission("ORDER_MANAGER", "batches.write")).toBe(false);
    expect(hasPermission("ORDER_MANAGER", "settings.write")).toBe(false);
  });

  it("does not let PRODUCT_MANAGER read customer PII", () => {
    expect(hasPermission("PRODUCT_MANAGER", "products.write")).toBe(true);
    expect(hasPermission("PRODUCT_MANAGER", "batches.write")).toBe(true);
    expect(hasPermission("PRODUCT_MANAGER", "customers.read")).toBe(false);
    expect(hasPermission("PRODUCT_MANAGER", "orders.read")).toBe(true);
    expect(hasPermission("PRODUCT_MANAGER", "orders.update")).toBe(false);
  });

  it("reserves store settings for ADMIN and SUPER_ADMIN", () => {
    expect(hasPermission("SUPER_ADMIN", "settings.write")).toBe(true);
    expect(hasPermission("ADMIN", "settings.write")).toBe(true);
    expect(hasPermission("ORDER_MANAGER", "settings.write")).toBe(false);
    expect(hasPermission("PRODUCT_MANAGER", "settings.write")).toBe(false);
    expect(hasPermission("VIEWER", "settings.write")).toBe(false);
  });

  it("only ever returns declared permissions", () => {
    for (const role of SCHEMA_ROLES) {
      for (const permission of permissionsFor(role)) {
        expect(ALL_PERMISSIONS).toContain(permission);
      }
    }
  });
});
