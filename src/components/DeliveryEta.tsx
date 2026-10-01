"use client";
import { useEffect, useState } from "react";

/**
 * The answer to "when will it arrive?", placed where the customer asks it.
 *
 * For a made-to-order pre-order that question is the main reason people leave,
 * and the answer already existed — in TrustFooter, at the bottom of the page,
 * below the very decision it is meant to help. This is the same promise with the
 * same lead time, moved next to the Add button.
 *
 * The dated branch is resolved in an effect rather than during render. The
 * formatted date depends on the viewer's timezone and on the current time, so
 * rendering it on the server as well would guarantee a hydration mismatch.
 * TrustFooter already reads the date this way.
 */
const LEAD_TIME = "2–3 weeks";

export function DeliveryEta({ batchEndAt }: { batchEndAt?: string | null }) {
  const [closesOn, setClosesOn] = useState<string | null>(null);

  useEffect(() => {
    if (!batchEndAt) {
      setClosesOn(null);
      return;
    }
    const closes = new Date(batchEndAt);
    if (Number.isNaN(closes.getTime()) || closes.getTime() <= Date.now()) {
      setClosesOn(null);
      return;
    }
    setClosesOn(closes.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  }, [batchEndAt]);

  return (
    <p
      style={{
        textAlign: "center",
        marginTop: "var(--space-2)",
        marginBottom: 0,
        fontSize: "var(--text-xs)",
        color: "rgba(255, 255, 255, 0.7)",
        lineHeight: 1.5,
      }}
    >
      Made to order — ships within {LEAD_TIME}{" "}
      {closesOn ? `after this drop closes on ${closesOn}.` : "of drop closure."}
    </p>
  );
}
