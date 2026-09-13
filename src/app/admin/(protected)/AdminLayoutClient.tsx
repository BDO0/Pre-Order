"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  hasPermission,
  ROLE_LABELS,
  type Permission,
} from "@/lib/permissions";
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
  permission: Permission;
}[] = [
  { href: "/admin/dashboard", label: "Dashboard", icon: "📊", permission: "reports.read" },
  { href: "/admin/orders",    label: "Orders",     icon: "📋", permission: "orders.read" },
  { href: "/admin/products",  label: "Products",   icon: "👗", permission: "products.read" },
  { href: "/admin/campaigns", label: "Campaigns",  icon: "🔗", permission: "campaigns.read" },
  { href: "/admin/settings",  label: "Settings",   icon: "⚙️", permission: "settings.write" },
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
    hasPermission(user.role, item.permission)
  );

  const roleLabel =
    typeof user.role === "string" && user.role in ROLE_LABELS
      ? ROLE_LABELS[user.role as AdminRole]
      : "Unknown role";

  return (
    <div className="admin-layout">
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          ANA Clothing
          <span>Admin Panel</span>
        </div>

        <nav className="admin-nav" aria-label="Admin navigation">
          {visibleItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`admin-nav-link ${pathname.startsWith(item.href) ? "active" : ""}`}
            >
              <span className="admin-nav-link-icon">{item.icon}</span>
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
