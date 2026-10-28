import { basename, join } from "node:path";
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; 
export const ALLOWED_UPLOAD_FORMATS = ["jpeg", "png", "webp"] as const;
export type AllowedUploadFormat = (typeof ALLOWED_UPLOAD_FORMATS)[number];
export const STORED_EXTENSION = ".webp";
export const STORED_MIME_TYPE = "image/webp";
export const MAX_STORED_DIMENSION = 1440;
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
export function publicUploadDir(): string {
  return join(process.cwd(), "public", "uploads");
}
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
export function mimeTypeForKey(key: string): string {
  const extension = basename(key).split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}
export function publicUrlForFile(filename: string): string {
  return `/uploads/${filename}`;
}
const LOCAL_UPLOAD_PREFIX = "/uploads/";
const SUPABASE_PUBLIC_PATH = "/storage/v1/object/public/";

/**
 * Whether a URL is one this app produced for an uploaded image.
 *
 * `images` on a product accepts any string, which is how a typo or a
 * hand-written URL can end up rendering as a broken image on the storefront.
 * Per-colour images multiply that surface - one URL per colour, per gallery
 * slot - so the write path checks them against the two shapes `lib/storage.ts`
 * can actually return: a local `/uploads/...` path, or a public object in the
 * configured Supabase bucket (`externalBase` is `SUPABASE_URL`).
 */
export function isStoredImageUrl(url: unknown, externalBase?: string | null): boolean {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed.length === 0 || trimmed.length > 1000) return false;
  if (trimmed.startsWith(LOCAL_UPLOAD_PREFIX)) {
    return isSafeStorageKey(trimmed.slice(LOCAL_UPLOAD_PREFIX.length));
  }
  const base = (externalBase ?? "").trim().replace(/\/+$/, "");
  if (base !== "" && trimmed.startsWith(`${base}${SUPABASE_PUBLIC_PATH}`)) {
    return isSafeStorageKey(trimmed.slice(base.length + SUPABASE_PUBLIC_PATH.length));
  }
  return false;
}