"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

/**
 * The confirmation screen.
 *
 * It carries the order's access token, which is the only way back to the order.
 * A customer who closes this page without saving the link can still use the
 * lookup form with their order number and Instagram username, so the token is a
 * convenience rather than a single point of failure — but it is offered first,
 * prominently, and with a copy button, because it is by far the easier route.
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
      // Clipboard permission can be denied; the link is visible to copy by hand.
      setCopied(false);
    }
  };

  return (
    <div className="empty-state" style={{ background: "white", borderRadius: "var(--radius-2xl)", padding: "var(--space-12)" }}>
      <div className="empty-state-icon" style={{ opacity: 1, fontSize: "4rem", marginBottom: "var(--space-2)" }}>🎉</div>
      <h1 className="empty-state-title" style={{ fontSize: "var(--text-3xl)", color: "var(--color-brand-600)" }}>
        Order Received!
      </h1>
      <p className="empty-state-text" style={{ maxWidth: "460px" }}>
        Thank you for your pre-order. We&apos;ll message you on Instagram to confirm
        sizing, shipping and payment.
      </p>

      {reference && (
        <div style={{ marginTop: "var(--space-6)", padding: "var(--space-4)", background: "var(--color-neutral-50)", borderRadius: "var(--radius-lg)", border: "1px dashed var(--color-neutral-300)" }}>
          <p style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", fontWeight: 600, color: "var(--color-neutral-500)", marginBottom: "var(--space-1)" }}>Your Order Number</p>
          <p style={{ fontSize: "var(--text-2xl)", fontWeight: 800, fontFamily: "var(--font-display)", color: "var(--color-neutral-900)", letterSpacing: "0.05em" }}>{reference}</p>
        </div>
      )}

      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", marginTop: "var(--space-5)", maxWidth: "460px" }}>
        Save the link below — it is the quickest way to check on your order. It is
        private to you, so please do not share it.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-3)", justifyContent: "center" }}>
        <code style={{ fontSize: "var(--text-xs)", background: "var(--color-neutral-100)", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-md)", maxWidth: "100%", overflowWrap: "anywhere" }}>
          {trackUrl}
        </code>
        <button type="button" onClick={copyLink} className="btn btn-secondary btn-sm">
          {copied ? "Copied ✓" : "Copy link"}
        </button>
      </div>

      <div style={{ display: "flex", gap: "var(--space-4)", marginTop: "var(--space-8)", flexWrap: "wrap", justifyContent: "center" }}>
        <Link href={trackUrl} className="btn btn-primary">Track Order</Link>
        <Link href="/" className="btn btn-secondary">Return Home</Link>
      </div>

      <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)", marginTop: "var(--space-5)" }}>
        Lost the link? Look your order up with your order number and Instagram username.
      </p>
    </div>
  );
}

export default function OrderSuccessPage() {
  return (
    <div style={{ minHeight: "100dvh", background: "var(--color-neutral-50)", padding: "var(--space-4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Suspense fallback={<div>Loading...</div>}>
        <SuccessContent />
      </Suspense>
    </div>
  );
}

