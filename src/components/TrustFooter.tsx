"use client";
import { SHOP_SOCIALS, SITE_NAME } from "@/lib/site";
import { formatShortDate } from "@/lib/format";
import React from "react";

export function TrustFooter({
  batchEndAt,
}: {
  batchEndAt?: string | null;
}) {
  const [isEta, setIsEta] = React.useState(false);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsEta(batchEndAt ? new Date(batchEndAt).getTime() > Date.now() : false);
  }, [batchEndAt]);

  const productionStart = formatShortDate(batchEndAt);
  const etaText =
    isEta && productionStart
      ? `Production starts on ${productionStart}. Less than 1 day within Metro Manila and 5–7 days to Mindanao.`
      : "Items are produced in limited batches. Delivery takes less than 1 day within Metro Manila and 5–7 days to Mindanao.";

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
          <h4 style={{ color: "white", fontWeight: 700, marginBottom: "var(--space-3)", fontSize: "var(--text-base)" }}>Follow Us</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", lineHeight: 1.6 }}>
            {SHOP_SOCIALS.map((social) => (
              <div key={social.label}>
                {social.label}:{" "}
                <a
                  href={social.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#ffb4c8", textDecoration: "none" }}
                >
                  {social.handle}
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ textAlign: "center", fontSize: "var(--text-xs)", opacity: 0.7 }}>
        <p>© {new Date().getFullYear()} {SITE_NAME}. All rights reserved.</p>
      </div>
    </footer>
  );
}
