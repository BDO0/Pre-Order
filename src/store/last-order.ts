export interface PersistedLastOrder {
  reference: string;
  accessToken: string | null;
  placedAt: string;
}

const STORAGE_KEY = "tp-last-preorder";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function saveLastOrder(order: PersistedLastOrder): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Ignore storage quota or private-browsing errors.
  }
}

export function loadLastOrder(): PersistedLastOrder | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedLastOrder>;
    if (
      typeof parsed?.reference !== "string" ||
      !parsed.reference.trim() ||
      typeof parsed?.placedAt !== "string"
    ) {
      return null;
    }
    const age = Date.now() - new Date(parsed.placedAt).getTime();
    if (Number.isNaN(age) || age > MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      reference: parsed.reference,
      accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken : null,
      placedAt: parsed.placedAt,
    };
  } catch {
    return null;
  }
}
