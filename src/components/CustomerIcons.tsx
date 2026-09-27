import React from "react";
export function CustomBagIcon({
  size = 18,
  className = "",
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}
export function CustomHangerIcon({
  size = 24,
  className = "",
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M12 4a2.2 2.2 0 0 1 2.2 2.2c0 .8-.5 1.5-1.2 1.9L12 8.6V10" />
      <path d="M12 10 2.5 16.8a1.5 1.5 0 0 0 .9 2.6h17.2a1.5 1.5 0 0 0 .9-2.6L12 10Z" />
      <path d="M7 16.5v1" />
      <path d="M17 16.5v1" />
    </svg>
  );
}
export function CustomDressIcon({
  size = 24,
  className = "",
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M8 3h8l1 6-2 1.5L19 21H5l4-10.5L7 9l1-6Z" />
      <path d="M9 3a3 3 0 0 0 6 0" />
      <path d="M7 11.5h10" />
    </svg>
  );
}
export function CustomTopIcon({
  size = 24,
  className = "",
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M9 3h6l2 2 4 2-2 4-2-1v11H7V10L5 11 3 7l4-2 2-2Z" />
      <path d="M9 3a3 3 0 0 0 6 0" />
    </svg>
  );
}
export function CustomJacketIcon({
  size = 24,
  className = "",
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M4 6 8 3h8l4 3-2 5-2-1v11H6V10L4 11 2 6l2 0Z" />
      <path d="M8 3v7l4 3 4-3V3" />
      <path d="M12 13v8" />
    </svg>
  );
}
export function CustomPantsIcon({
  size = 24,
  className = "",
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M5 4h14v3l-2 14h-4l-1-9-1 9H7L5 7V4Z" />
      <path d="M5 7h14" />
      <path d="M12 4v4" />
    </svg>
  );
}
export function CustomCheckSealIcon({
  size = 48,
  className = "",
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.35" />
      <circle cx="24" cy="24" r="16.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" strokeOpacity="0.6" />
      <path
        d="m16 24 5.5 5.5 11.5-12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function CustomCardIcon({
  size = 20,
  className = "",
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
      <line x1="6" x2="10" y1="15" y2="15" />
    </svg>
  );
}
export function CustomAlertIcon({
  size = 18,
  className = "",
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}
export function GarmentSilhouette({
  category,
  name,
  size = 36,
  className = "",
  style,
}: {
  category?: string | null;
  name?: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const cat = (category || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (
    cat.includes("bottom") ||
    n.includes("pant") ||
    n.includes("cargo") ||
    n.includes("trouser") ||
    n.includes("short") ||
    n.includes("jean")
  ) {
    return <CustomPantsIcon size={size} className={className} style={style} />;
  }
  if (
    cat.includes("outer") ||
    n.includes("parka") ||
    n.includes("jacket") ||
    n.includes("coat") ||
    n.includes("blazer")
  ) {
    return <CustomJacketIcon size={size} className={className} style={style} />;
  }
  if (
    cat.includes("dress") ||
    n.includes("dress") ||
    n.includes("skirt") ||
    n.includes("gown")
  ) {
    return <CustomDressIcon size={size} className={className} style={style} />;
  }
  if (
    cat.includes("top") ||
    n.includes("shirt") ||
    n.includes("tee") ||
    n.includes("sweatshirt") ||
    n.includes("hoodie") ||
    n.includes("blouse")
  ) {
    return <CustomTopIcon size={size} className={className} style={style} />;
  }
  return <CustomHangerIcon size={size} className={className} style={style} />;
}
