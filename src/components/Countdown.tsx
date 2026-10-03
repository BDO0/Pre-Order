"use client";
import { useEffect, useState } from "react";

export function Countdown({ targetDate }: { targetDate: string }) {
  const [label, setLabel] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const describe = (): string | null => {
      const remaining = new Date(targetDate).getTime() - Date.now();
      if (remaining <= 0) return null;
      const days = Math.floor(remaining / 86_400_000);
      const hours = Math.floor((remaining / 3_600_000) % 24);
      const minutes = Math.floor((remaining / 60_000) % 60);
      const seconds = Math.floor((remaining / 1000) % 60);
      return days > 0
        ? `Closes in ${days}d ${hours}h ${minutes}m`
        : `Closes in ${hours}h ${minutes}m ${seconds}s`;
    };

    const tick = () => setLabel(describe());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [targetDate]);

  if (!mounted) {
    return (
      <span className="badge badge-open" style={{ visibility: "hidden" }}>
        Closes in 00h 00m 00s
      </span>
    );
  }
  if (!label) return null;
  return <span className="badge badge-open">{label}</span>;
}
