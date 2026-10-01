import Link from "next/link";
import glass from "@/app/glass.module.css";
import { BrandLogo } from "@/components/BrandLogo";

export default function NotFound() {
  return (
    <div className={glass.glassPage} style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <div className={glass.bg} aria-hidden="true" />
      <div className={glass.orb1} aria-hidden="true" />
      <div className={glass.orb2} aria-hidden="true" />
      <div className={glass.content} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "var(--space-8)" }}>
        <div style={{ marginBottom: "var(--space-8)" }}>
          <BrandLogo variant="horizontal" height={40} />
        </div>
        <div className={glass.glassCard} style={{ padding: "var(--space-12) var(--space-8)", maxWidth: "500px", width: "100%", textAlign: "center" }}>
          <h1 className={glass.pageTitleEditorial} style={{ fontSize: "2.5rem", marginBottom: "var(--space-4)" }}>404</h1>
          <h2 style={{ fontSize: "1.25rem", color: "white", marginBottom: "var(--space-4)" }}>Page Not Found</h2>
          <p style={{ color: "rgba(255,255,255,0.8)", marginBottom: "var(--space-8)", lineHeight: 1.6 }}>
            The batch, product, or page you're looking for doesn't exist, has ended, or has been removed.
          </p>
          <Link href="/" className="btn btn-primary btn-lg" style={{ width: "100%", justifyContent: "center" }}>
            Return to Active Drops
          </Link>
        </div>
      </div>
    </div>
  );
}
