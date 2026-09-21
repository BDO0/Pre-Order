/**
 * Batch helpers, shared by the API and the admin screens.
 *
 * Pure: no Prisma, so the UI can reason about a batch's state without the server
 * having to compute it, and without pulling a database client into the browser.
 */

/** What a stored ETA means, in the words the operator needs. */
export type EtaState = "none" | "scheduled" | "soon" | "arrived";

/** Days before an ETA that a batch counts as "soon" and worth chasing. */
export const ETA_SOON_DAYS = 7;

/**
 * Parses an ETA coming from a form.
 *
 * The shape is already validated by zod; this only handles the two cases zod
 * passes through and Prisma must not store verbatim: an empty string (the
 * operator cleared the date input) and an absent field. Both mean "no ETA".
 */
export function parseEta(value: string | null | undefined): Date | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * A URL-safe slug derived from a batch name.
 *
 * The server derives this rather than trusting the client to send one. A slug is
 * an implementation detail of the URL, and every attempt to make the admin form
 * supply it ended the same way: the form posted a name and nothing else and the
 * request was rejected, or two batches were given the same slug. Accents are
 * folded rather than dropped, so "Summer Café" becomes "summer-cafe". A name
 * with no ASCII letters at all yields "" — the caller supplies the fallback,
 * because only it can decide what a name that cannot be a URL should become.
 */
export function slugifyBatchName(name: string): string {
  return name
    .normalize("NFKD")
    // NFKD splits "é" into "e" + a combining mark; the mark is what we discard.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * Stored instants and `datetime-local` field values, in both directions.
 *
 * `toISOString()` is UTC; a `datetime-local` input is local wall-clock time.
 * Treating one as the other shifts the moment by the viewer's offset on every
 * save, which is how an ETA silently drifts by hours each time a form is edited.
 * These two functions are the only place that conversion happens, so the shift
 * can only be introduced once.
 */
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

/** Inverse of `toDateTimeInputValue`: local wall-clock → ISO instant, or null. */
export function fromDateTimeInputValue(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * How urgent a batch's ETA is.
 *
 * `arrived` is not a stored flag: a batch whose date has passed either arrived or
 * is late, and either way it needs the operator's attention, so it is derived
 * from the clock rather than from a status someone has to remember to set.
 */
export function etaState(etaAt: Date | string | null | undefined, now = new Date()): EtaState {
  if (!etaAt) return "none";

  const eta = etaAt instanceof Date ? etaAt : new Date(etaAt);
  if (Number.isNaN(eta.getTime())) return "none";

  const daysUntil = (eta.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);

  if (daysUntil < 0) return "arrived";
  if (daysUntil <= ETA_SOON_DAYS) return "soon";
  return "scheduled";
}

/** Human label for an ETA, including how many days are left. */
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
