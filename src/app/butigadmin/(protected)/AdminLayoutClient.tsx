"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  hasPermission,
  ROLE_LABELS,
  type Permission,
} from "@/lib/permissions";
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [mobileMenuOpen]);

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
      <header className="admin-mobilebar">
        <div className="admin-mobilebar-top">
          <button
            type="button"
            className="admin-mobilebar-menu-btn"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="admin-mobile-drawer"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <Link href="/butigadmin/dashboard" className="admin-mobilebar-brand-link" aria-label="Admin Dashboard">
            <BrandLogo variant="horizontal" height={24} color="#fff" textColor="#fff" subtextColor="rgba(255, 255, 255, 0.72)" />
          </Link>
        </div>
      </header>
      <div
        className={`admin-mobile-backdrop ${mobileMenuOpen ? "is-open" : ""}`}
        onClick={() => setMobileMenuOpen(false)}
        aria-hidden={!mobileMenuOpen}
      />
      <aside
        id="admin-mobile-drawer"
        className={`admin-mobile-drawer ${mobileMenuOpen ? "is-open" : ""}`}
        aria-label="Mobile admin navigation"
        aria-hidden={!mobileMenuOpen}
      >
        <div className="admin-mobile-drawer-header">
          <BrandLogo variant="horizontal" height={26} color="#fff" textColor="#fff" subtextColor="rgba(255, 255, 255, 0.72)" />
          <button
            type="button"
            className="admin-mobile-drawer-close"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <nav className="admin-nav" aria-label="Admin navigation">
          {visibleItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileMenuOpen(false)}
              className={`admin-nav-link ${isActiveHref(item.href) ? "active" : ""}`}
            >
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="admin-drawer-footer">
          <div style={{ marginBottom: "var(--space-4)" }}>
            <p style={{ color: "white", fontWeight: 600, fontSize: "var(--text-sm)" }}>
              {user.name ?? "Admin"}
            </p>
            <p style={{ color: "rgb(255 255 255 / 0.6)", fontSize: "var(--text-xs)", marginTop: "2px", wordBreak: "break-all" }}>
              {user.email}
            </p>
            <p className="admin-role-pill">{roleLabel}</p>
          </div>
          <button
            type="button"
            className="admin-drawer-signout"
            onClick={() => signOut({ callbackUrl: "/butigadmin/login" })}
          >
            Sign Out
          </button>
        </div>
      </aside>
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
