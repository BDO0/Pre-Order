"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SuccessContent() {
  const searchParams = useSearchParams();
  const reference = searchParams.get("ref");

  return (
    <div className="empty-state" style={{ background: "white", borderRadius: "var(--radius-2xl)", padding: "var(--space-12)" }}>
      <div className="empty-state-icon" style={{ opacity: 1, fontSize: "4rem", marginBottom: "var(--space-2)" }}>🎉</div>
      <h1 className="empty-state-title" style={{ fontSize: "var(--text-3xl)", color: "var(--color-brand-600)" }}>
        Order Received!
      </h1>
      <p className="empty-state-text" style={{ maxWidth: "400px" }}>
        Thank you for your pre-order. We have successfully received your request.
      </p>

      {reference && (
        <div style={{ marginTop: "var(--space-6)", padding: "var(--space-4)", background: "var(--color-neutral-50)", borderRadius: "var(--radius-lg)", border: "1px dashed var(--color-neutral-300)" }}>
          <p style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", fontWeight: 600, color: "var(--color-neutral-500)", marginBottom: "var(--space-1)" }}>Your Order Reference Number</p>
          <p style={{ fontSize: "var(--text-2xl)", fontWeight: 800, fontFamily: "var(--font-display)", color: "var(--color-neutral-900)", letterSpacing: "0.05em" }}>{reference}</p>
        </div>
      )}

      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", marginTop: "var(--space-4)", maxWidth: "400px" }}>
        Please save this reference number. You can use it to track the status of your order anytime.
      </p>

      <div style={{ display: "flex", gap: "var(--space-4)", marginTop: "var(--space-8)" }}>
        <Link href={`/order-status?ref=${reference || ""}`} className="btn btn-primary">Track Order</Link>
        <Link href="/" className="btn btn-secondary">Return Home</Link>
      </div>
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
