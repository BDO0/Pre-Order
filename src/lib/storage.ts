import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { publicUploadDir, publicUrlForFile, type UploadPurpose } from "@/lib/uploads";

/**
 * Where uploaded imagery actually goes.
 *
 * There is one reason this module exists: `public/` is read-only on Vercel (and
 * on every other serverless host), so writing a file into it works in
 * development and fails with EROFS in production. That is the worst possible
 * shape for a bug — it only appears after deploy, and only when the operator is
 * trying to publish a drop.
 *
 * So the destination is a driver. Local disk stays the default, because a
 * self-hosted box, a container with a volume or a developer's laptop all work
 * perfectly and need no account anywhere. Supabase Storage is the alternative,
 * and it needs no new dependency: it is a plain authenticated HTTP upload
 * against the Storage API, and this project's database is already a Supabase one.
 *
 * Environment names follow what `.env.example` already reserved, so no existing
 * deployment has to be renamed.
 */

export type StorageDriverName = "local" | "supabase";

/** What a stored file is called afterwards, and how to reach it. */
export interface StoredObject {
  /** Storage key. For local files this is the public URL path. */
  key: string;
  /** World-readable URL, or null when the driver cannot serve one publicly. */
  url: string | null;
  driver: StorageDriverName;
}

export interface StorageDriver {
  name: StorageDriverName;
  /** True when this driver is configured well enough to accept a write. */
  isConfigured(): boolean;
  /** Human explanation, shown to the operator when a write fails. */
  describe(): string;
  save(input: {
    filename: string;
    bytes: Buffer;
    contentType: string;
    purpose: UploadPurpose;
  }): Promise<StoredObject>;
}

/** Reads an env var, treating whitespace-only as unset. */
function env(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Which bucket holds which kind of imagery.
 *
 * Separate buckets rather than one folder: batch artwork and product
 * photography have different lifetimes, and an operator rebuilding one set
 * should not have to touch the other.
 */
export function bucketForPurpose(purpose: UploadPurpose): string {
  return purpose === "BATCH_IMAGE"
    ? env("STORAGE_BUCKET_BATCHES") ?? "batches"
    : env("STORAGE_BUCKET_PRODUCTS") ?? "products";
}

/**
 * The local-filesystem driver.
 *
 * Writes under `public/uploads`, which Next.js serves statically — no route, no
 * authentication and no cache to invalidate, which is exactly right for
 * storefront imagery.
 */
const localDriver: StorageDriver = {
  name: "local",
  isConfigured: () => true,
  describe: () => `local disk (${join("public", "uploads")})`,
  async save({ filename, bytes }) {
    const directory = env("LOCAL_UPLOAD_DIR") ?? publicUploadDir();

    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, filename), bytes);

    const url = publicUrlForFile(filename);
    return { key: url, url, driver: "local" };
  },
};


/**
 * The Supabase Storage driver.
 *
 * Uses the service-role key, which must never reach the browser — this module is
 * server-only and the key is read from the server environment. Objects are
 * uploaded with `x-upsert: true` so a retry of the same generated filename
 * overwrites rather than erroring; filenames are random, so a collision means a
 * retry, not two real images clashing.
 */
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
          "Supabase Storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY)."
        );
      }

      const bucket = bucketForPurpose(purpose);
      const objectPath = `${bucket}/${filename}`;

      const response = await fetch(`${baseUrl}/storage/v1/object/${objectPath}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": contentType,
          "x-upsert": "true",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
        body: new Uint8Array(bytes),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Supabase Storage rejected the upload (HTTP ${response.status}). ${detail.slice(0, 300)}`
        );
      }

      return {
        key: objectPath,
        // The public URL shape, which only resolves when the bucket is public.
        // A private bucket would need a signed URL per read, which is not what
        // storefront imagery wants.
        url: `${baseUrl}/storage/v1/object/public/${objectPath}`,
        driver: "supabase",
      };
    },
  };
}

/**
 * The driver to use.
 *
 * `STORAGE_PROVIDER` wins when it names a known driver; otherwise Supabase is
 * chosen automatically as soon as its credentials are present, on the assumption
 * that an operator who configured object storage wants it used. Everything else
 * falls back to local disk.
 */
export function getStorageDriver(): StorageDriver {
  const requested = env("STORAGE_PROVIDER")?.toLowerCase();
  const supabase = supabaseDriver();

  if (requested === "supabase") return supabase;
  if (requested === "local") return localDriver;

  return supabase.isConfigured() ? supabase : localDriver;
}

/** What the health endpoint and the admin panel report about storage. */
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

/**
 * True for the filesystem errors that mean "this host cannot store files".
 *
 * Checked separately from a generic failure so the API can answer with an
 * actionable 503 instead of a vague 500: an operator who is told the deployment
 * cannot write to disk knows to configure object storage, whereas "something
 * went wrong" tells them nothing.
 */
export function isReadOnlyFilesystemError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "EROFS" || code === "EACCES" || code === "EPERM";
}
