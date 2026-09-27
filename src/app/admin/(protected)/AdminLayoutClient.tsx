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
import { BrandLogo } from "@/components/BrandLogo";
import type { AdminRole } from "@prisma/client";
const NAV_ITEMS: readonly {
  href: string;
  label: string;
  permission?: Permission;
}[] = [
  { href: "/butigadmin/dashboard", label: "Dashboard", permission: "reports.read" },
  { href: "/butigadmin/orders",    label: "Orders",    permission: "orders.read" },
  { href: "/butigadmin/batches",   label: "Batches",   permission: "batches.read" },
  { href: "/butigadmin/products",  label: "Products",  permission: "products.read" },
  { href: "/butigadmin/account",   label: "Account" },
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
  const isActiveHref = (href: string) =>
    href === "/butigadmin/batches"
      ? pathname === "/butigadmin/batches"
      : pathname === href || pathname.startsWith(href + "/");
  const roleLabel =
    typeof user.role === "string" && user.role in ROLE_LABELS
      ? ROLE_LABELS[user.role as AdminRole]
      : "Unknown role";
  return (
    <div className="admin-layout">
      {}
      <header className="admin-mobilebar">
        <div className="admin-mobilebar-top">
          <BrandLogo variant="horizontal" height={22} color="#fff" textColor="#fff" subtextColor="rgba(255, 255, 255, 0.7)" />
          <button
            type="button"
            className="admin-mobilebar-signout"
            onClick={() => signOut({ callbackUrl: "/butigadmin/login" })}
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
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </header>
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <BrandLogo variant="stacked" height={42} color="#fff" textColor="#fff" subtextColor="rgba(255, 255, 255, 0.7)" />
          <span style={{ textAlign: "center", fontSize: "var(--text-xs)", letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255, 255, 255, 0.6)" }}>
            Admin Panel
          </span>
        </div>
        <nav className="admin-nav" aria-label="Admin navigation">
          {visibleItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`admin-nav-link ${isActiveHref(item.href) ? "active" : ""}`}
            >
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
            onClick={() => signOut({ callbackUrl: "/butigadmin/login" })}
          >
            Sign Out
          </button>
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
