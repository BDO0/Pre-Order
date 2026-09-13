import { basename, join } from "node:path";

/**
 * Where uploads live and how a stored key maps back to a file.
 *
 * Two very different things are uploaded here and they must not share a
 * directory:
 *
 *  - public/  product & campaign imagery that belongs in the storefront.
 *  - private/ payment proofs — screenshots of a customer's bank app, i.e. PII.
 *    They are never reachable by URL; the admin panel streams them through
 *    /api/admin/proofs/<key>, which checks the session first.
 *
 * Server-only (uses node:path / process.cwd).
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB

/** Formats sharp is allowed to decode. GIF is excluded: animated/lossy. */
export const ALLOWED_UPLOAD_FORMATS = ["jpeg", "png", "webp"] as const;
export type AllowedUploadFormat = (typeof ALLOWED_UPLOAD_FORMATS)[number];

/**
 * Everything is re-encoded to WebP before it touches disk. Re-encoding is the
 * point: it destroys embedded scripts (a valid image can also be valid HTML,
 * which is stored XSS when served from our origin), strips EXIF — including the
 * GPS coordinates a customer's phone may have written into a payment screenshot
 * — and guarantees the bytes on disk match the declared content type.
 */
export const STORED_EXTENSION = ".webp";
export const STORED_MIME_TYPE = "image/webp";

/** Longest edge kept after re-encode; proofs only need to be readable. */
export const MAX_STORED_DIMENSION = 2400;

export type UploadPurpose = "PAYMENT_PROOF" | "PRODUCT_IMAGE" | "CAMPAIGN_IMAGE";

export const UPLOAD_PURPOSES: readonly UploadPurpose[] = [
  "PAYMENT_PROOF",
  "PRODUCT_IMAGE",
  "CAMPAIGN_IMAGE",
];

export function isUploadPurpose(value: unknown): value is UploadPurpose {
  return (
    typeof value === "string" &&
    (UPLOAD_PURPOSES as readonly string[]).includes(value)
  );
}

/** True for uploads that must never be world-readable. */
export function isPrivatePurpose(purpose: UploadPurpose): boolean {
  return purpose === "PAYMENT_PROOF";
}

/** Public tree served straight off the CDN/static handler. */
export function publicUploadDir(): string {
  return join(process.cwd(), "public", "uploads");
}

/** Private tree, deliberately outside `public/`. */
export function privateProofDir(): string {
  const base =
    process.env.PRIVATE_UPLOAD_DIR && process.env.PRIVATE_UPLOAD_DIR.trim() !== ""
      ? process.env.PRIVATE_UPLOAD_DIR
      : join(process.cwd(), "private", "uploads");
  return join(base, "proofs");
}

/**
 * A key is only accepted when it is a plain relative path.
 *
 * `fileKey` values arrive from the database and from request bodies, so a
 * crafted `../../.env` must be rejected here rather than being handed to
 * `readFile`. Absolute paths, drive letters and backslashes are refused too.
 */
export function isSafeStorageKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  const trimmed = key.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  if (/[\u0000-\u001f]/.test(trimmed)) return false;
  if (trimmed.includes("\\") || trimmed.includes("..")) return false;
  if (/^[a-zA-Z]:/.test(trimmed)) return false;
  return /^\/?[a-zA-Z0-9._/-]+$/.test(trimmed);
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Content type for a stored key, based on its extension. */
export function mimeTypeForKey(key: string): string {
  const extension = basename(key).split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/**
 * Filesystem candidates for a proof key, in priority order.
 *
 * New keys look like `proofs/<id>.webp` and live in the private tree. Rows
 * written before this split hold `/uploads/<id>.jpg` and their files are still
 * in `public/uploads`, so both layouts are supported and nothing has to be
 * migrated in a hurry.
 */
export function proofCandidatesForKey(key: string): string[] {
  if (!isSafeStorageKey(key)) return [];
  const name = basename(key);
  if (!name || name === "/" || name === ".") return [];
  const candidates = [join(privateProofDir(), name)];
  if (key.startsWith("proofs/") || key.startsWith("/proofs/")) {
    return candidates;
  }
  candidates.push(join(publicUploadDir(), name));
  return candidates;
}

/** The public URL for a stored public upload (product/campaign imagery). */
export function publicUrlForFile(filename: string): string {
  return `/uploads/${filename}`;
}
