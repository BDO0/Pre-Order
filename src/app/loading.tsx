import glass from "@/app/glass.module.css";
import { BrandLogo } from "@/components/BrandLogo";

export default function Loading() {
  return (
    <div className={glass.glassPage} style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <div className={glass.bg} aria-hidden="true" />
      <div className={glass.orb1} aria-hidden="true" />
      <div className={glass.orb2} aria-hidden="true" />
      <div className={glass.content} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
        <div style={{ animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" }}>
          <BrandLogo variant="monogram" height={60} />
        </div>
      </div>
    </div>
  );
}
