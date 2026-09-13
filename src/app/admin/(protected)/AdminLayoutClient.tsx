"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const NAV_ITEMS = [
  { href: "/admin/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/admin/orders",    label: "Orders",     icon: "📋" },
  { href: "/admin/products",  label: "Products",   icon: "👗" },
  { href: "/admin/campaigns", label: "Campaigns",  icon: "🔗" },
  { href: "/admin/settings",  label: "Settings",   icon: "⚙️" },
];

export default function AdminLayoutClient({
  children,
  user,
}: {
  children: React.ReactNode;
  user: { name?: string | null; email?: string | null };
}) {
  const pathname = usePathname();

  return (
    <div className="admin-layout">
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          ANA Clothing
          <span>Admin Panel</span>
        </div>

        <nav className="admin-nav" aria-label="Admin navigation">
          {NAV_ITEMS.map((item) => (
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
