import { ImageResponse } from "next/og";
import { TUDUNGPEOPLE_EMBLEM_PATH } from "@/components/BrandLogo";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #4a0c1c 0%, #160207 100%)",
          borderRadius: "7px",
          border: "1px solid rgba(255, 200, 220, 0.45)",
        }}
      >
        <svg
          width="24"
          height="18"
          viewBox="384 246 1220 910"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d={TUDUNGPEOPLE_EMBLEM_PATH}
            fill="#ffffff"
            fillRule="evenodd"
          />
        </svg>
      </div>
    ),
    { ...size }
  );
}
