export interface StockCountableVariant {
  active?: boolean;
  capacity?: number | null;
  remainingCapacity?: number | null;
}

export interface DetailedVariant extends StockCountableVariant {
  id?: string;
  size?: string | null;
  color?: string | null;
  sku?: string | null;
}

export interface OptionAvailability {
  name: string;
  remaining: number;
  capacity: number | null;
  isUnlimited: boolean;
  isSoldOut: boolean;
  isLowStock: boolean;
  activeCount: number;
  pairedOptions: string[];
}

export interface ProductAvailabilityOverview {
  totalVariants: number;
  activeVariants: number;
  colors: OptionAvailability[];
  sizes: OptionAvailability[];
  totalRemaining: number;
  totalCapacity: number | null;
  hasUnlimited: boolean;
  isSoldOut: boolean;
  isLowStock: boolean;
  summaryText: string;
}

export function stockSummary(variants: readonly StockCountableVariant[] | undefined): string {
  const live = (variants ?? []).filter((variant) => variant.active !== false);
  if (live.length === 0) return "—";
  const capped = live.filter(
    (variant) => typeof variant.capacity === "number" && typeof variant.remainingCapacity === "number"
  );
  if (capped.length === 0) return "unlimited";
  const remaining = capped.reduce((sum, variant) => sum + (variant.remainingCapacity ?? 0), 0);
  const capacity = capped.reduce((sum, variant) => sum + (variant.capacity ?? 0), 0);
  const uncapped = live.length - capped.length;
  return `${remaining} / ${capacity}${uncapped > 0 ? ` (+${uncapped} unlimited)` : ""}`;
}

export function activeVariantCount(
  variants: readonly StockCountableVariant[] | undefined
): number {
  return (variants ?? []).filter((variant) => variant.active !== false).length;
}

export function variantCountLabel(
  variants: readonly StockCountableVariant[] | undefined
): string {
  const count = activeVariantCount(variants);
  return `${count} ${count === 1 ? "variant" : "variants"}`;
}

export function getProductAvailabilityOverview(
  variants: readonly DetailedVariant[] | undefined
): ProductAvailabilityOverview {
  const all = variants ?? [];
  const live = all.filter((v) => v.active !== false);

  if (live.length === 0) {
    return {
      totalVariants: all.length,
      activeVariants: 0,
      colors: [],
      sizes: [],
      totalRemaining: 0,
      totalCapacity: 0,
      hasUnlimited: false,
      isSoldOut: true,
      isLowStock: false,
      summaryText: all.length === 0 ? "No variants" : "All variants inactive",
    };
  }

  // Group by Color
  const colorMap = new Map<string, DetailedVariant[]>();
  for (const v of live) {
    const key = v.color?.trim() || "Standard";
    const list = colorMap.get(key) ?? [];
    list.push(v);
    colorMap.set(key, list);
  }

  const colors: OptionAvailability[] = Array.from(colorMap.entries()).map(([name, list]) => {
    const capped = list.filter(
      (v) => typeof v.capacity === "number" && typeof v.remainingCapacity === "number"
    );
    const hasUncapped = list.some((v) => v.capacity === null);
    const remaining = capped.reduce((acc, v) => acc + (v.remainingCapacity ?? 0), 0);
    const capacity = hasUncapped
      ? null
      : capped.reduce((acc, v) => acc + (v.capacity ?? 0), 0);
    const isSoldOut = !hasUncapped && remaining === 0;
    const isLowStock = !hasUncapped && remaining > 0 && remaining <= 3;
    const pairedSizes = Array.from(
      new Set(list.map((v) => v.size?.trim()).filter((s): s is string => Boolean(s)))
    );

    return {
      name,
      remaining,
      capacity,
      isUnlimited: hasUncapped,
      isSoldOut,
      isLowStock,
      activeCount: list.length,
      pairedOptions: pairedSizes,
    };
  });

  // Group by Size
  const sizeMap = new Map<string, DetailedVariant[]>();
  for (const v of live) {
    const key = v.size?.trim() || "One Size";
    const list = sizeMap.get(key) ?? [];
    list.push(v);
    sizeMap.set(key, list);
  }

  const sizes: OptionAvailability[] = Array.from(sizeMap.entries()).map(([name, list]) => {
    const capped = list.filter(
      (v) => typeof v.capacity === "number" && typeof v.remainingCapacity === "number"
    );
    const hasUncapped = list.some((v) => v.capacity === null);
    const remaining = capped.reduce((acc, v) => acc + (v.remainingCapacity ?? 0), 0);
    const capacity = hasUncapped
      ? null
      : capped.reduce((acc, v) => acc + (v.capacity ?? 0), 0);
    const isSoldOut = !hasUncapped && remaining === 0;
    const isLowStock = !hasUncapped && remaining > 0 && remaining <= 3;
    const pairedColors = Array.from(
      new Set(list.map((v) => v.color?.trim()).filter((c): c is string => Boolean(c)))
    );

    return {
      name,
      remaining,
      capacity,
      isUnlimited: hasUncapped,
      isSoldOut,
      isLowStock,
      activeCount: list.length,
      pairedOptions: pairedColors,
    };
  });

  const cappedAll = live.filter(
    (v) => typeof v.capacity === "number" && typeof v.remainingCapacity === "number"
  );
  const hasUnlimited = live.some((v) => v.capacity === null);
  const totalRemaining = cappedAll.reduce((acc, v) => acc + (v.remainingCapacity ?? 0), 0);
  const totalCapacity = hasUnlimited
    ? null
    : cappedAll.reduce((acc, v) => acc + (v.capacity ?? 0), 0);
  const isSoldOut = !hasUnlimited && totalRemaining === 0;
  const isLowStock = !hasUnlimited && totalRemaining > 0 && totalRemaining <= 3;

  let summaryText = "";
  if (hasUnlimited) {
    summaryText = totalRemaining > 0 ? `${totalRemaining} capped + unlimited` : "Unlimited availability";
  } else if (isSoldOut) {
    summaryText = "Sold Out";
  } else if (isLowStock) {
    summaryText = `Low Stock (${totalRemaining} left)`;
  } else {
    summaryText = `${totalRemaining} / ${totalCapacity} available`;
  }

  return {
    totalVariants: all.length,
    activeVariants: live.length,
    colors,
    sizes,
    totalRemaining,
    totalCapacity,
    hasUnlimited,
    isSoldOut,
    isLowStock,
    summaryText,
  };
}

const COMMON_COLOR_HEXES: Record<string, string> = {
  black: "#171717",
  white: "#f8fafc",
  red: "#ef4444",
  burgundy: "#800020",
  maroon: "#800000",
  navy: "#1e3a8a",
  blue: "#3b82f6",
  "sky blue": "#38bdf8",
  green: "#22c55e",
  olive: "#556b2f",
  yellow: "#eab308",
  mustard: "#d97706",
  orange: "#f97316",
  pink: "#ec4899",
  "baby pink": "#fbcfe8",
  rose: "#f43f5e",
  purple: "#a855f7",
  lavender: "#c084fc",
  brown: "#78350f",
  tan: "#d2b48c",
  beige: "#f5f5dc",
  cream: "#fffdd0",
  grey: "#6b7280",
  gray: "#6b7280",
  silver: "#cbd5e1",
  gold: "#eab308",
  charcoal: "#374151",
};

export function colorHexHint(colorName?: string | null): string | null {
  if (!colorName) return null;
  const key = colorName.trim().toLowerCase();
  return COMMON_COLOR_HEXES[key] ?? null;
}