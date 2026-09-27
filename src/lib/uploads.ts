import { basename, join } from "node:path";

/**
 * Where uploads live and how a stored key maps back to a file.
 *
 * Only public imagery is uploaded now: product and batch photographs that
 * belong in the storefront. Payment proofs are gone from the product entirely —
 * there is no customer-facing payment step, so nothing private is ever written
 * to disk and there is no guarded-read route to maintain.
 *
 * Server-only (uses node:path / process.cwd).
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB safety ceiling

/** Formats sharp is allowed to decode. GIF is excluded: animated/lossy. */
export const ALLOWED_UPLOAD_FORMATS = ["jpeg", "png", "webp"] as const;
export type AllowedUploadFormat = (typeof ALLOWED_UPLOAD_FORMATS)[number];

/**
 * Everything is re-encoded to WebP before it touches disk. Re-encoding is the
 * point: it destroys embedded scripts (a valid image can also be valid HTML,
 * which is stored XSS when served from our origin), strips EXIF, and guarantees
 * the bytes on disk match the declared content type.
 */
export const STORED_EXTENSION = ".webp";
export const STORED_MIME_TYPE = "image/webp";

/** Longest edge kept after re-encode: 2560px for Ultra-HD Retina clarity. */
export const MAX_STORED_DIMENSION = 2560;

export type UploadPurpose = "PRODUCT_IMAGE" | "BATCH_IMAGE";

export const UPLOAD_PURPOSES: readonly UploadPurpose[] = [
  "PRODUCT_IMAGE",
  "BATCH_IMAGE",
];

export function isUploadPurpose(value: unknown): value is UploadPurpose {
  return (
    typeof value === "string" &&
    (UPLOAD_PURPOSES as readonly string[]).includes(value)
  );
}

/** Public tree served straight off the CDN/static handler. */
export function publicUploadDir(): string {
  return join(process.cwd(), "public", "uploads");
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

/** The public URL for a stored upload (product/campaign imagery). */
export function publicUrlForFile(filename: string): string {
  return `/uploads/${filename}`;
}
