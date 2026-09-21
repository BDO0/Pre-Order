"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  hasPermission,
  ROLE_LABELS,
  type Permission,
} from "@/lib/permissions";
import { SITE_NAME } from "@/lib/site";
import type { AdminRole } from "@prisma/client";

/**
 * Each destination declares the permission it needs, and the list is filtered by
 * the same matrix the API enforces.
 *
 * This is convenience, not security: hiding a link only stops someone wandering
 * into a screen that would render empty. The route handler behind every screen
 * calls requirePermission() itself, so replays and deep links are rejected
 * server-side regardless of what the nav shows.
 */
const NAV_ITEMS: readonly {
  href: string;
  label: string;
  icon: string;
  /**
   * The permission this destination requires. Omitted on screens that are about
   * the signed-in person rather than about a resource — the account screen is
   * about your own password, so every role can open it, including a VIEWER.
   */
  permission?: Permission;
}[] = [
  { href: "/admin/dashboard",         label: "Dashboard", icon: "📊", permission: "reports.read" },
  { href: "/admin/orders",            label: "Orders",    icon: "📋", permission: "orders.read" },
  { href: "/admin/batches",           label: "Batches",   icon: "📦", permission: "batches.read" },
  { href: "/admin/products",          label: "Products",  icon: "👗", permission: "products.read" },
  { href: "/admin/settings",          label: "Settings",  icon: "⚙️", permission: "settings.write" },
  { href: "/admin/account",           label: "Account",   icon: "👤" },
];

export default function AdminLayoutClient({
  children,
  user,
}: {
  children: React.ReactNode;
  user: {
    name?: string | null;
    email?: string | null;
    role?: AdminRole | string | null;
  };
}) {
  const pathname = usePathname();

  const visibleItems = NAV_ITEMS.filter((item) =>
    item.permission ? hasPermission(user.role, item.permission) : true
  );

  /**
   * `/admin/batches` is a destination, not a prefix of one: no other screen lives
   * beneath it, so it must not light up for a path that merely starts with it.
   */
  const isActiveHref = (href: string) =>
    href === "/admin/batches"
      ? pathname === "/admin/batches"
      : pathname === href || pathname.startsWith(href + "/");

  const roleLabel =
    typeof user.role === "string" && user.role in ROLE_LABELS
      ? ROLE_LABELS[user.role as AdminRole]
      : "Unknown role";

  return (
    <div className="admin-layout">
      {/* Mobile navigation.
          Below 768px the sidebar is `display: none`, and it holds the only Sign
          Out button in the app — so without this bar the operator could reach
          exactly one screen and had no way to log out. Same destinations, same
          permission filtering, one horizontally scrollable strip of 48px tap
          targets. Hidden again from 768px up, where the sidebar is better. */}
      <header className="admin-mobilebar">
        <div className="admin-mobilebar-top">
          <span className="admin-mobilebar-brand">{SITE_NAME}</span>
          <button
            type="button"
            className="admin-mobilebar-signout"
            onClick={() => signOut({ callbackUrl: "/admin/login" })}
          >
            Sign Out
          </button>
        </div>

        <nav className="admin-mobilebar-nav" aria-label="Admin navigation">
          {visibleItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`admin-mobilebar-link ${isActiveHref(item.href) ? "active" : ""}`}
            >
              <span aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </header>

      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          {SITE_NAME}
          <span>Admin Panel</span>
        </div>

        <nav className="admin-nav" aria-label="Admin navigation">
          {visibleItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`admin-nav-link ${isActiveHref(item.href) ? "active" : ""}`}
            >
              <span className="admin-nav-link-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div style={{ marginTop: "auto", paddingTop: "var(--space-6)", borderTop: "1px solid rgb(255 255 255 / 0.15)" }}>
          <div style={{ marginBottom: "var(--space-4)" }}>
            <p style={{ color: "white", fontWeight: 600, fontSize: "var(--text-sm)" }}>
              {user.name ?? "Admin"}
            </p>
            <p style={{ color: "rgb(255 255 255 / 0.55)", fontSize: "var(--text-xs)", marginTop: "2px" }}>
              {user.email}
            </p>
            {/* Staff should be able to see what they are allowed to do. */}
            <p
              style={{
                display: "inline-block",
                marginTop: "var(--space-2)",
                padding: "2px var(--space-2)",
                borderRadius: "var(--radius-md)",
                background: "rgb(255 255 255 / 0.12)",
                color: "rgb(255 255 255 / 0.75)",
                fontSize: "var(--text-xs)",
                fontWeight: 600,
                letterSpacing: "0.02em",
              }}
            >
              {roleLabel}
            </p>
          </div>
          <button
            style={{
              width: "100%",
              padding: "var(--space-2) var(--space-4)",
              borderRadius: "var(--radius-lg)",
              background: "rgb(255 255 255 / 0.1)",
              color: "rgb(255 255 255 / 0.8)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              cursor: "pointer",
              border: "1px solid rgb(255 255 255 / 0.15)",
              textAlign: "left",
              transition: "all 150ms ease",
            }}
            onClick={() => signOut({ callbackUrl: "/admin/login" })}
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="admin-main">{children}</main>
    </div>
  );
}
