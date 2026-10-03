const CURRENCY_SYMBOLS: Record<string, string> = {
  PHP: "₱",
  USD: "$",
  EUR: "€",
  GBP: "£",
  SGD: "S$",
  MYR: "RM",
  IDR: "Rp",
  THB: "฿",
  JPY: "¥",
};

const DEFAULT_CURRENCY = "PHP";

export function formatMoney(amount: number, currency: string = DEFAULT_CURRENCY): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const code = (currency || DEFAULT_CURRENCY).trim().toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
  const digits = Math.abs(safeAmount).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${safeAmount < 0 ? "-" : ""}${symbol}${digits}`;
}

export function formatShortDate(value: string | number | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
