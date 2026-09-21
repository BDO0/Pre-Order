/**
 * The Instagram handle is the customer's identity in this app.
 *
 * Every payment, address and sizing question is settled in DM, so the handle is
 * the one piece of contact data that is always correct — and it is what makes
 * two orders from "Juan dela Cruz" distinguishable. It is therefore the key the
 * whole app agrees on: the customer row, the duplicate check, the public status
 * lookup and the OG/new badge all compare handles, never names.
 *
 * Storage is normalised (lowercase, no leading "@") so that "@JuanDC",
 * "JUANDC", "juandc" and a pasted instagram.com URL are one identity. A leading
 * "@" is not part of a handle, and Instagram is case-insensitive on handles.
 *
 * Client-safe: plain data and regexes, no Prisma, no node APIs.
 */

/**
 * What an Instagram handle may contain.
 *
 * Instagram allows letters, digits, periods and underscores, 1-30 characters.
 * Lowercase only, because the value is normalised before it is tested.
 */
export const INSTAGRAM_HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/;

/** Human-readable rule, reused by the API and the form so they cannot disagree. */
export const INSTAGRAM_HANDLE_HINT =
  "Your Instagram username, e.g. @juandc. Letters, numbers, periods and underscores only.";

/** Bit.ly-style prefixes people paste instead of their handle. */
const INSTAGRAM_URL_PATTERN =
  /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)\/?.*$/i;

/** Strips a pasted URL, an "@" and any trailing path, then lowercases. */
export function normaliseInstagramHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  let value = raw.trim();
  if (value === "") return null;

  const urlMatch = INSTAGRAM_URL_PATTERN.exec(value);
  if (urlMatch) value = urlMatch[1];

  value = value.replace(/^@+/, "").trim().toLowerCase();

  if (!INSTAGRAM_HANDLE_PATTERN.test(value)) return null;

  return value;
}

/** True when `raw` already is a normalised handle (what the database holds). */
export function isNormalisedHandle(raw: unknown): raw is string {
  return typeof raw === "string" && raw === normaliseInstagramHandle(raw);
}

/** How a handle is written back to a human: with the "@" people expect. */
export function formatInstagramHandle(handle: string): string {
  return `@${handle}`;
}

/** Deep link to the account, for the admin panel. */
export function instagramProfileUrl(handle: string): string {
  return `https://instagram.com/${encodeURIComponent(handle)}`;
}
