"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { SITE_NAME } from "@/lib/site";
import { CustomCheckSealIcon } from "@/components/CustomerIcons";
import { BrandLogo } from "@/components/BrandLogo";
import glass from "../glass.module.css";

/**
 * The confirmation screen.
 */
function SuccessContent() {
  const searchParams = useSearchParams();
  const reference = searchParams.get("ref");
  const token = searchParams.get("token");

  const [copied, setCopied] = useState(false);

  const trackUrl =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/order-status?token=${encodeURIComponent(token)}`
      : reference
        ? `/order-status?ref=${encodeURIComponent(reference)}`
        : "/order-status";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(trackUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      style={{
        position: "relative",
        background: "rgba(255, 255, 255, 0.08)",
        backdropFilter: "blur(32px) saturate(200%)",
        WebkitBackdropFilter: "blur(32px) saturate(200%)",
        borderRadius: "var(--radius-2xl)",
        border: "1px solid rgba(255, 255, 255, 0.16)",
        padding: "clamp(var(--space-6), 5vw, var(--space-10)) clamp(var(--space-4), 4vw, var(--space-8))",
        maxWidth: "580px",
        width: "100%",
        boxShadow:
          "0 24px 64px rgba(0, 0, 0, 0.65), 0 0 36px rgba(255, 175, 200, 0.22), 0 0 64px rgba(156, 232, 248, 0.14), inset 0 1.5px 1px 0 rgba(255, 255, 255, 0.55), inset 0 -1px 1px 0 rgba(255, 255, 255, 0.1)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-4)",
        textAlign: "center",
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-start", width: "100%", marginBottom: "var(--space-2)" }}>
        <Link href="/" className={glass.navBack} style={{ fontSize: "var(--text-sm)" }}>
          ← Back to Shop
        </Link>
      </div>

      <div
        style={{
          width: "76px",
          height: "76px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(168, 16, 56, 0.45) 0%, rgba(255, 255, 255, 0.05) 70%)",
          border: "1px solid rgba(255, 200, 220, 0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 0 28px rgba(255, 175, 200, 0.35)",
        }}
        aria-hidden="true"
      >
        <CustomCheckSealIcon size={46} style={{ color: "#ffffff" }} />
      </div>

      <h1
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "clamp(2rem, 4vw, 2.5rem)",
          fontWeight: 700,
          background: "linear-gradient(135deg, #ffffff 0%, #ffeaf0 50%, #f7b4c4 100%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          WebkitTextFillColor: "transparent",
          margin: 0,
          letterSpacing: "-0.01em",
        }}
      >
        Order Received!
      </h1>

      <p style={{ fontSize: "var(--text-base)", color: "rgba(255, 255, 255, 0.75)", maxWidth: "440px", lineHeight: 1.6, margin: 0 }}>
        Thank you for your pre-order. We&apos;ll message you on Instagram to confirm
        sizing, shipping and payment.
      </p>

      {reference && (
        <div
          style={{
            width: "100%",
            marginTop: "var(--space-2)",
            padding: "var(--space-4) var(--space-6)",
            background: "rgba(168, 16, 56, 0.2)",
            backdropFilter: "blur(16px)",
            borderRadius: "var(--radius-xl)",
            border: "1px dashed rgba(255, 200, 220, 0.4)",
            boxShadow: "inset 0 1px 1px 0 rgba(255, 255, 255, 0.2)",
          }}
        >
          <p
            style={{
              fontSize: "var(--text-xs)",
              textTransform: "uppercase",
              fontWeight: 700,
              color: "rgba(255, 255, 255, 0.85)",
              marginBottom: "var(--space-1)",
              letterSpacing: "0.08em",
            }}
          >
            Your Order Number
          </p>
          <p
            style={{
              fontSize: "var(--text-3xl)",
              fontWeight: 800,
              fontFamily: "var(--font-display)",
              color: "#ffffff",
              letterSpacing: "0.06em",
              margin: 0,
              textShadow: "0 2px 12px rgba(220, 40, 85, 0.5)",
            }}
          >
            {reference}
          </p>
        </div>
      )}

      <p style={{ fontSize: "var(--text-sm)", color: "rgba(255, 255, 255, 0.85)", maxWidth: "440px", margin: 0, lineHeight: 1.6 }}>
        Save the link below — it is the quickest way to check on your order. It is
        private to you, so please do not share it.
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-2)",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <code
          style={{
            fontSize: "var(--text-xs)",
            background: "rgba(255, 255, 255, 0.07)",
            color: "rgba(255, 255, 255, 0.95)",
            padding: "var(--space-2) var(--space-4)",
            borderRadius: "var(--radius-full)",
            maxWidth: "100%",
            overflowWrap: "anywhere",
            border: "1px solid rgba(255, 255, 255, 0.15)",
          }}
        >
          {trackUrl}
        </code>
        <button type="button" onClick={copyLink} className="btn btn-secondary btn-sm">
          {copied ? "Copied ✓" : "Copy Link"}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: "var(--space-3)",
          marginTop: "var(--space-4)",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <Link href="/" className="btn btn-secondary btn-lg" style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
          ← Back to Shop
        </Link>
        <Link href={trackUrl} className="btn btn-primary btn-lg" style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
          Track Your Order →
        </Link>
      </div>

      <p style={{ fontSize: "var(--text-xs)", color: "rgba(255, 255, 255, 0.78)", marginTop: "var(--space-1)" }}>
        Lost the link? Look your order up anytime with your order number and Instagram username.
      </p>
    </div>
  );
}

export default function OrderSuccessPage() {
  return (
    <div className={glass.glassPage}>
      <div className={glass.bg} aria-hidden="true" />
      <div className={glass.orb1} aria-hidden="true" />
      <div className={glass.orb2} aria-hidden="true" />
      <div className={glass.orb3} aria-hidden="true" />

      <div className={glass.content}>
        <nav className={glass.nav}>
          <div className={glass.navInner}>
            <Link href="/" className={glass.navBrand} aria-label={SITE_NAME}>
              <BrandLogo variant="horizontal" height={34} />
            </Link>
            <div className={glass.navActions}>
              <Link href="/" className={glass.navGhostBtn} aria-label="Back to Shop">
                ← <span className={glass.mobileHideText}>Back to </span>Shop
              </Link>
            </div>
          </div>
        </nav>

        <main
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--space-8) var(--space-4)",
          }}
        >
          <Suspense
            fallback={
              <div style={{ color: "rgba(255,255,255,.6)", fontFamily: "var(--font-display)" }}>
                Loading confirmation...
              </div>
            }
          >
            <SuccessContent />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
