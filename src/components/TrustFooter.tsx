"use client";
import { SHOP_INSTAGRAM_HANDLE, SHOP_INSTAGRAM_URL, SITE_NAME } from "@/lib/site";
import React from "react";

export function TrustFooter({
  batchEndAt,
}: {
  batchEndAt?: string | null;
}) {
  const [isEta, setIsEta] = React.useState(false);

  React.useEffect(() => {
    setIsEta(batchEndAt ? new Date(batchEndAt).getTime() > Date.now() : false);
  }, [batchEndAt]);

  const etaText = isEta
    ? `Production starts on ${new Date(batchEndAt!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Expect delivery within 2-3 weeks from that date.`
    : "Items are produced in limited batches and shipped within 2-3 weeks of drop closure.";

  return (
    <footer style={{
      width: "100%",
      maxWidth: "1000px",
      margin: "0 auto",
      padding: "var(--space-12) var(--space-6) var(--space-6)",
      color: "rgba(255, 255, 255, 0.7)",
      fontSize: "var(--text-sm)",
      borderTop: "1px solid rgba(255, 255, 255, 0.1)",
      marginTop: "var(--space-12)"
    }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: "var(--space-8)",
        marginBottom: "var(--space-12)"
      }}>
        <div>
          <h4 style={{ color: "white", fontWeight: 700, marginBottom: "var(--space-3)", fontSize: "var(--text-base)" }}>How long until it arrives?</h4>
          <p style={{ lineHeight: 1.6 }}>{etaText}</p>
        </div>
        <div>
          <h4 style={{ color: "white", fontWeight: 700, marginBottom: "var(--space-3)", fontSize: "var(--text-base)" }}>What if the size is wrong?</h4>
          <p style={{ lineHeight: 1.6 }}>We will gladly arrange an exchange if your item does not fit perfectly, subject to remaining stock.</p>
        </div>
        <div>
          <h4 style={{ color: "white", fontWeight: 700, marginBottom: "var(--space-3)", fontSize: "var(--text-base)" }}>How do I pay?</h4>
          <p style={{ lineHeight: 1.6 }}>Add items to your cart and check out. No payment is collected upfront. We&apos;ll reach out on Instagram to arrange payment when your order is secured.</p>
        </div>
        <div>
          <h4 style={{ color: "white", fontWeight: 700, marginBottom: "var(--space-3)", fontSize: "var(--text-base)" }}>Who are you?</h4>
          <p style={{ lineHeight: 1.6 }}>{SITE_NAME} creates highly limited handcrafted clothing. Follow us <a href={SHOP_INSTAGRAM_URL} target="_blank" rel="noreferrer" style={{ color: "#ffb4c8", textDecoration: "none" }}>@{SHOP_INSTAGRAM_HANDLE}</a>.</p>
        </div>
      </div>
      <div style={{ textAlign: "center", fontSize: "var(--text-xs)", opacity: 0.7 }}>
        <p>© {new Date().getFullYear()} {SITE_NAME}. All rights reserved.</p>
      </div>
    </footer>
  );
}
