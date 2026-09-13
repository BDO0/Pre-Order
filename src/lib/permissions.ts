// Type-only import: this module is safe to import from client components
// (the matrix is plain data, no Prisma runtime is pulled in).
import type { AdminRole } from "@prisma/client";

/**
 * Permission categories, mirroring the catalogue in the project brief:
 *
 *   orders.read      orders.update   products.read   products.write
 *   campaigns.read   campaigns.write customers.read  reports.read
 *   settings.write   payments.read   payments.verify
 *
 * `payments.*` is split out of `orders.*` on purpose: reviewing a transfer
 * receipt is a different job from packing and shipping, so an ORDER_MANAGER can
 * be trusted with the queue without also being able to mark money as received.
 */
export type Permission =
  | "orders.read"
  | "orders.update"
  | "payments.read"
  | "payments.verify"
  | "products.read"
  | "products.write"
  | "campaigns.read"
  | "campaigns.write"
  | "customers.read"
  | "reports.read"
  | "settings.write";

export const ALL_PERMISSIONS: readonly Permission[] = [
  "orders.read",
  "orders.update",
  "payments.read",
  "payments.verify",
  "products.read",
  "products.write",
  "campaigns.read",
  "campaigns.write",
  "customers.read",
  "reports.read",
  "settings.write",
];

/**
 * Role → permissions.
 *
 * VIEWER is deliberately read-only, and every role includes only what its job
 * needs. `hasPermission` denies anything not listed here, so adding a permission
 * constant without granting it fails closed rather than open.
 */
const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,

  ADMIN: [
    "orders.read",
    "orders.update",
    "payments.read",
    "payments.verify",
    "products.read",
    "products.write",
    "campaigns.read",
    "campaigns.write",
    "customers.read",
    "reports.read",
    "settings.write",
  ],

  // Runs the order queue: sees customers and payment proofs, cannot touch the
  // catalogue, the storefront settings, or create/delete campaigns.
  ORDER_MANAGER: [
    "orders.read",
    "orders.update",
    "payments.read",
    "payments.verify",
    "customers.read",
    "reports.read",
    "products.read",
    "campaigns.read",
  ],

  // Owns the catalogue and the drops, has no business reading customer PII.
  PRODUCT_MANAGER: [
    "products.read",
    "products.write",
    "campaigns.read",
    "campaigns.write",
    "reports.read",
    "orders.read",
  ],

  VIEWER: [
    "orders.read",
    "payments.read",
    "products.read",
    "campaigns.read",
    "customers.read",
    "reports.read",
  ],
};

/** Human-readable role names for the admin chrome. */
export const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  ORDER_MANAGER: "Order Manager",
  PRODUCT_MANAGER: "Product Manager",
  VIEWER: "Viewer",
};

const KNOWN_ROLES = new Set<string>(Object.keys(ROLE_PERMISSIONS));

/** True when `role` is one the matrix knows about. */
export function isKnownRole(role: unknown): role is AdminRole {
  return typeof role === "string" && KNOWN_ROLES.has(role);
}

/**
 * The single source of truth for authorization.
 *
 * A missing, stale or misspelled role returns false: a session minted before a
 * role was renamed must lose access rather than silently keep it.
 */
export function hasPermission(
  role: string | null | undefined,
  permission: Permission
): boolean {
  if (!isKnownRole(role)) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Every permission held by `role`, for the UI to mirror (never to enforce). */
export function permissionsFor(role: string | null | undefined): Permission[] {
  if (!isKnownRole(role)) return [];
  return [...ROLE_PERMISSIONS[role]];
}
