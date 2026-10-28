import { formatMoney } from "./format";

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

/**
 * Hard ceiling for one basket line when neither the variant stock nor the
 * product's pre-order limit caps it, so the stepper never offers "unlimited".
 */
export const MAX_LINE_QUANTITY = 99;

/**
 * The most units a single basket line may hold: the variant's own remaining
 * stock, further capped by the product's overall pre-order limit, and
 * `MAX_LINE_QUANTITY` when both are unlimited.
 *
 * `remainingCapacity` alone is not enough - a product with unlimited variant
 * stock and a `preorderLimit` of 5 would let a shopper build a basket of 10 and
 * only be rejected at checkout. The stepper, the derived quantity and the
 * add-to-basket action all have to read the same number.
 */
export function quantityCap(
  variant: StockCountableVariant | null | undefined,
  productRemaining?: number | null
): number {
  return Math.min(
    variant?.remainingCapacity ?? MAX_LINE_QUANTITY,
    productRemaining ?? MAX_LINE_QUANTITY
  );
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

export interface ProductListingInput {
  name: string;
  slug: string;
  category?: string | null;
  price: string | number;
  preorderStatus?: string;
  variants?: readonly DetailedVariant[];
}

/**
 * Builds a clean, social-media / messaging-ready summary text of a product,
 * including availability, color/size matrix, and customer order link.
 */
export function buildProductListingSummary(
  product: ProductListingInput,
  overview: ProductAvailabilityOverview,
  baseUrl: string = ""
): string {
  const lines: string[] = [];

  // Title & Basic Info
  lines.push(`🛍️ ${product.name}`);
  if (product.category) {
    lines.push(`📁 Category: ${product.category}`);
  }
  lines.push(`💰 Price: ${formatMoney(Number(product.price))}`);

  const statusLabel =
    product.preorderStatus === "OPEN"
      ? "Open for Pre-Order"
      : product.preorderStatus === "COMING_SOON"
      ? "Coming Soon"
      : product.preorderStatus === "SOLD_OUT"
      ? "Sold Out"
      : product.preorderStatus === "CLOSED"
      ? "Closed"
      : product.preorderStatus || "Active";

  lines.push(`📦 Status: ${statusLabel}`);
  lines.push(`📊 Stock Overview: ${overview.summaryText}`);

  // Colors breakdown
  if (overview.colors.length > 0) {
    lines.push("");
    lines.push("🎨 Available Colors:");
    for (const c of overview.colors) {
      const stock = c.isUnlimited
        ? "Unlimited"
        : c.isSoldOut
        ? "Sold Out"
        : `${c.remaining} left`;
      lines.push(`  • ${c.name}: ${stock}`);
    }
  }

  // Sizes breakdown
  if (overview.sizes.length > 0) {
    lines.push("");
    lines.push("📏 Available Sizes:");
    for (const s of overview.sizes) {
      const stock = s.isUnlimited
        ? "Unlimited"
        : s.isSoldOut
        ? "Sold Out"
        : `${s.remaining} left`;
      lines.push(`  • ${s.name}: ${stock}`);
    }
  }

  // Detailed Variant Combinations Breakdown
  const activeVariants = (product.variants ?? []).filter((v) => v.active !== false);
  if (activeVariants.length > 0) {
    lines.push("");
    lines.push("📋 Variant Breakdown:");
    for (const v of activeVariants) {
      const color = v.color || "Standard";
      const size = v.size || "One Size";
      const isUncapped = v.capacity === null;
      const rem = v.remainingCapacity ?? 0;
      const stock = isUncapped
        ? "Unlimited"
        : rem === 0
        ? "Sold Out"
        : `${rem} available`;
      lines.push(`  • ${color} / ${size} — ${stock}`);
    }
  }

  // Pre-Order Link
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const link = cleanBase ? `${cleanBase}/preorder/${product.slug}` : `/preorder/${product.slug}`;
  lines.push("");
  lines.push(`🔗 Pre-Order Link: ${link}`);

  return lines.join("\n");
}