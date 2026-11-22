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
        color: "rgba(248, 245, 240, 0.78)",
        lineHeight: 1.5,
      }}
    >
      Made to order — crafted in {LEAD_TIME}{" "}
      {closesOn ? `after this drop closes on ${closesOn}` : "after drop closure"}.
      Courier transit once shipped: &lt;1 day Metro Manila, 5–7 days provincial.
    </p>
  );
}
