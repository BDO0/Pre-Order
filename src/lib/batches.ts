export type EtaState = "none" | "scheduled" | "soon" | "arrived";
export const ETA_SOON_DAYS = 7;

export type BatchWindowState = "open" | "not_started" | "expired" | "closed";

export interface BatchWindowInput {
  status?: string | null;
  startAt?: Date | string | null;
  endAt?: Date | string | null;
}

export function getBatchWindowState(
  batch: BatchWindowInput | null | undefined,
  now = new Date()
): BatchWindowState {
  if (!batch || batch.status !== "OPEN") return "closed";
  if (batch.startAt) {
    const start = batch.startAt instanceof Date ? batch.startAt : new Date(batch.startAt);
    if (!Number.isNaN(start.getTime()) && now < start) return "not_started";
  }
  if (batch.endAt) {
    const end = batch.endAt instanceof Date ? batch.endAt : new Date(batch.endAt);
    if (!Number.isNaN(end.getTime()) && now > end) return "expired";
  }
  return "open";
}

export function isBatchAcceptingOrders(
  batch: BatchWindowInput | null | undefined,
  now = new Date()
): boolean {
  return getBatchWindowState(batch, now) === "open";
}

export function parseEta(value: string | null | undefined): Date | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
export function slugifyBatchName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}
export function toDateTimeInputValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join("T");
}
export function fromDateTimeInputValue(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
export function etaState(etaAt: Date | string | null | undefined, now = new Date()): EtaState {
  if (!etaAt) return "none";
  const eta = etaAt instanceof Date ? etaAt : new Date(etaAt);
  if (Number.isNaN(eta.getTime())) return "none";
  const daysUntil = (eta.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  if (daysUntil < 0) return "arrived";
  if (daysUntil <= ETA_SOON_DAYS) return "soon";
  return "scheduled";
}
export function describeEta(etaAt: Date | string | null | undefined, now = new Date()): string {
  if (!etaAt) return "No ETA yet";
  const eta = etaAt instanceof Date ? etaAt : new Date(etaAt);
  if (Number.isNaN(eta.getTime())) return "No ETA yet";
  const days = Math.round((eta.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 0) return `Was due ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}
