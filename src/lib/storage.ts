import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  publicUploadDir,
  publicUrlForFile,
  type UploadPurpose,
} from "@/lib/uploads";
export type StorageDriverName = "local" | "supabase";
export interface StoredObject {
  key: string;
  url: string | null;
  driver: StorageDriverName;
}
export interface StorageDriver {
  name: StorageDriverName;
  isConfigured(): boolean;
  describe(): string;
  save(input: {
    filename: string;
    bytes: Buffer;
    contentType: string;
    purpose: UploadPurpose;
  }): Promise<StoredObject>;
}
function env(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
export function bucketForPurpose(purpose: UploadPurpose): string {
  return purpose === "BATCH_IMAGE"
    ? (env("STORAGE_BUCKET_BATCHES") ?? "batches")
    : (env("STORAGE_BUCKET_PRODUCTS") ?? "products");
}
const localDriver: StorageDriver = {
  name: "local",
  isConfigured: () => true,
  describe: () => `local disk (${join("public", "uploads")})`,
  async save({ filename, bytes }) {
    const directory = env("LOCAL_UPLOAD_DIR") ?? publicUploadDir();
    await mkdir(/*turbopackIgnore: true*/ directory, { recursive: true });
    await writeFile(join(/*turbopackIgnore: true*/ directory, filename), bytes);
    const url = publicUrlForFile(filename);
    return { key: url, url, driver: "local" };
  },
};
function supabaseDriver(): StorageDriver {
  const baseUrl = env("SUPABASE_URL")?.replace(/\/+$/, "");
  const serviceKey = env("SUPABASE_SERVICE_KEY");
  return {
    name: "supabase",
    isConfigured: () => Boolean(baseUrl && serviceKey),
    describe: () =>
      baseUrl
        ? `Supabase Storage at ${baseUrl} (buckets: ${bucketForPurpose("PRODUCT_IMAGE")}, ${bucketForPurpose("BATCH_IMAGE")})`
        : "Supabase Storage (SUPABASE_URL is not set)",
    async save({ filename, bytes, contentType, purpose }) {
      if (!baseUrl || !serviceKey) {
        throw new Error(
          "Supabase Storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY).",
        );
      }
      const bucket = bucketForPurpose(purpose);
      const objectPath = `${bucket}/${filename}`;
      const response = await fetch(
        `${baseUrl}/storage/v1/object/${objectPath}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": contentType,
            "x-upsert": "true",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
          body: new Uint8Array(bytes),
        },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Supabase Storage rejected the upload (HTTP ${response.status}). ${detail.slice(0, 300)}`,
        );
      }
      return {
        key: objectPath,
        url: `${baseUrl}/storage/v1/object/public/${objectPath}`,
        driver: "supabase",
      };
    },
  };
}
export function getStorageDriver(): StorageDriver {
  const requested = env("STORAGE_PROVIDER")?.toLowerCase();
  const supabase = supabaseDriver();
  if (requested === "supabase") return supabase;
  if (requested === "local") return localDriver;
  return supabase.isConfigured() ? supabase : localDriver;
}
export function describeStorage(): {
  driver: StorageDriverName;
  configured: boolean;
  detail: string;
} {
  const driver = getStorageDriver();
  return {
    driver: driver.name,
    configured: driver.isConfigured(),
    detail: driver.describe(),
  };
}
export function isReadOnlyFilesystemError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "EROFS" || code === "EACCES" || code === "EPERM";
}
