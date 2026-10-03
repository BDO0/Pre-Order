"use client";
import { useEffect, useState } from "react";
import { formatShortDate } from "@/lib/format";

const LEAD_TIME = "2–3 weeks";

export function DeliveryEta({ batchEndAt }: { batchEndAt?: string | null }) {
  const [closesOn, setClosesOn] = useState<string | null>(null);

  useEffect(() => {
    if (!batchEndAt) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClosesOn(null);
      return;
    }
    const closes = new Date(batchEndAt);
    if (Number.isNaN(closes.getTime()) || closes.getTime() <= Date.now()) {
      setClosesOn(null);
      return;
    }
    setClosesOn(formatShortDate(closes));
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
