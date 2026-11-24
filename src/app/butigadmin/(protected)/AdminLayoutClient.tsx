"use client";
import { useState, useEffect, type ReactNode } from "react";
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
  icon: ReactNode;
}[] = [
  {
    href: "/butigadmin/dashboard",
    label: "Dashboard",
    permission: "reports.read",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
  {
    href: "/butigadmin/orders",
    label: "Orders",
    permission: "orders.read",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="M9 12h6" />
        <path d="M9 16h6" />
      </svg>
    ),
  },
  {
    href: "/butigadmin/batches",
    label: "Batches",
    permission: "batches.read",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    href: "/butigadmin/products",
    label: "Products",
    permission: "products.read",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    ),
  },
  {
    href: "/butigadmin/archive",
    label: "Archive",
    permission: "reports.read",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="21 8 21 21 3 21 3 8" />
        <rect x="1" y="3" width="22" height="5" />
        <line x1="10" y1="12" x2="14" y2="12" />
      </svg>
    ),
  },
  {
    href: "/butigadmin/settings",
    label: "Settings",
    permission: "settings.write",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    href: "/butigadmin/account",
    label: "Account",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
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

  const renderNavLinks = (closeMobile: boolean) => (
    <nav className="admin-nav" aria-label="Admin navigation">
      {visibleItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={closeMobile ? () => setMobileMenuOpen(false) : undefined}
          className={`admin-nav-link ${isActiveHref(item.href) ? "active" : ""}`}
        >
          <span className="admin-nav-link-icon">{item.icon}</span>
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );

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
        {renderNavLinks(true)}
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
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <Link
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              className="admin-drawer-signout"
              style={{ textDecoration: "none", display: "block" }}
            >
              View Storefront ↗
            </Link>
            <button
              type="button"
              className="admin-drawer-signout"
              onClick={() => signOut({ callbackUrl: "/butigadmin/login" })}
            >
              Sign Out
            </button>
          </div>
        </div>
      </aside>
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <BrandLogo variant="stacked" height={42} color="#fff" textColor="#fff" subtextColor="rgba(255, 255, 255, 0.7)" />
          <span style={{ textAlign: "center", fontSize: "var(--text-xs)", letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255, 255, 255, 0.6)" }}>
            Admin Panel
          </span>
        </div>
        {renderNavLinks(false)}
        <div style={{ marginTop: "auto", paddingTop: "var(--space-6)", borderTop: "1px solid rgb(255 255 255 / 0.15)" }}>
          <div style={{ marginBottom: "var(--space-4)" }}>
            <p style={{ color: "white", fontWeight: 600, fontSize: "var(--text-sm)" }}>
              {user.name ?? "Admin"}
            </p>
            <p style={{ color: "rgb(255 255 255 / 0.55)", fontSize: "var(--text-xs)", marginTop: "2px" }}>
              {user.email}
            </p>
            <p className="admin-role-pill">{roleLabel}</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <Link
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              className="admin-drawer-signout"
              style={{ textDecoration: "none", display: "block", minHeight: "36px", fontSize: "var(--text-xs)" }}
            >
              View Storefront ↗
            </Link>
            <button
              type="button"
              className="admin-drawer-signout"
              style={{ minHeight: "38px" }}
              onClick={() => signOut({ callbackUrl: "/butigadmin/login" })}
            >
              Sign Out
            </button>
          </div>
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
