import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { requirePermission, isSameOrigin } from "@/lib/api-guard";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import {
  ALLOWED_UPLOAD_FORMATS,
  MAX_STORED_DIMENSION,
  MAX_UPLOAD_BYTES,
  STORED_EXTENSION,
  STORED_MIME_TYPE,
  isPrivatePurpose,
  isUploadPurpose,
  privateProofDir,
  publicUploadDir,
  publicUrlForFile,
  type UploadPurpose,
} from "@/lib/uploads";

// Never cached, never prerendered.
export const dynamic = "force-dynamic";

/** Guard against decompression bombs: 50MP is far beyond any phone camera. */
const MAX_INPUT_PIXELS = 50_000_000;

/** Which permission each non-public upload purpose requires. */
const PURPOSE_PERMISSION = {
  PRODUCT_IMAGE: "products.write",
  CAMPAIGN_IMAGE: "campaigns.write",
} as const;

function failure(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

/**
 * Image upload.
 *
 * Hardening applied here, all of it in response to concrete attacks:
 *
 *  1. `purpose` decides where a file lands and who may send it. Product and
 *     campaign imagery is public and requires `products.write` / `campaigns.write`;
 *     a payment proof comes from an anonymous shopper mid-checkout, so it is the
 *     only purpose an unauthenticated caller may use.
 *  2. The bytes are decoded with sharp and re-encoded to WebP. `file.type` is a
 *     client-controlled string and the old code trusted it — a valid PNG can also
 *     be valid HTML, so serving it from our own origin was stored XSS.
 *     Re-encoding destroys any embedded markup, strips EXIF (a payment
 *     screenshot can carry the device's GPS coordinates) and guarantees the
 *     extension matches the content.
 *  3. Filenames are generated server-side, so a crafted `name` cannot escape the
 *     upload directory or overwrite anything.
 *  4. Proofs go to a private directory that is not served statically; the admin
 *     panel streams them through /api/admin/proofs behind `orders.read`.
 *  5. Rate limited, because an unauthenticated write endpoint is otherwise free
 *     disk space for anyone.
 */
export async function POST(request: NextRequest) {
  try {
    const limited = enforceRateLimit(request, RATE_LIMITS.upload);
    if (limited) return limited;

    if (!isSameOrigin(request)) {
      return failure(403, "CROSS_ORIGIN_BLOCKED", "This request did not come from this site.");
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return failure(400, "INVALID_BODY", "Expected a multipart form upload.");
    }

    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return failure(400, "NO_FILE", "No file provided.");
    }

    // Default to the strictest private purpose when the field is missing.
    const rawPurpose = formData.get("purpose");
    const purpose: UploadPurpose = isUploadPurpose(rawPurpose)
      ? rawPurpose
      : "PAYMENT_PROOF";

    if (purpose !== "PAYMENT_PROOF") {
      const guard = await requirePermission(PURPOSE_PERMISSION[purpose], request);
      if (!guard.ok) return guard.response;
    }

    // Size is checked on the declared length before the buffer is materialised.
    if (file.size > MAX_UPLOAD_BYTES) {
      return failure(400, "FILE_TOO_LARGE", "File must be less than 5MB.");
    }
    if (file.size === 0) {
      return failure(400, "EMPTY_FILE", "The uploaded file is empty.");
    }

    const input = Buffer.from(await file.arrayBuffer());

    // A real decode, not a MIME sniff: this throws for anything that is not a
    // well-formed image, whatever the client claimed it was. `.catch` turns the
    // throw into a null so the failure path is explicit and the inferred type
    // stays with the variable.
    const metadata = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .metadata()
      .catch(() => null);

    if (!metadata) {
      return failure(
        400,
        "INVALID_IMAGE",
        "That file could not be read as an image. Please upload a JPG, PNG or WebP."
      );
    }

    const format = metadata.format;
    if (
      !format ||
      !(ALLOWED_UPLOAD_FORMATS as readonly string[]).includes(format)
    ) {
      return failure(400, "INVALID_TYPE", "Only JPG, PNG, and WebP are allowed.");
    }

    if (!metadata.width || !metadata.height) {
      return failure(400, "INVALID_IMAGE", "That image has no readable dimensions.");
    }

    const normalised = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      // Honour the EXIF orientation, then discard EXIF entirely.
      .rotate()
      .resize({
        width: MAX_STORED_DIMENSION,
        height: MAX_STORED_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    const filename = `${randomBytes(16).toString("hex")}${STORED_EXTENSION}`;
    const isPrivate = isPrivatePurpose(purpose);
    const directory = isPrivate ? privateProofDir() : publicUploadDir();
    const filepath = join(directory, filename);

    try {
      await mkdir(directory, { recursive: true });
      await writeFile(filepath, normalised.data);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
        // Serverless filesystems are read-only. Say so plainly: an operator can
        // act on this message, whereas "Failed to upload file" hides the cause.
        console.error("[POST /api/upload] read-only filesystem", error);
        return failure(
          503,
          "STORAGE_UNAVAILABLE",
          "This deployment cannot store files on local disk. Configure object storage (see docs/DEPLOYMENT.md)."
        );
      }
      throw error;
    }

    // The storage key is what finds the file again. Proofs return no public URL
    // on purpose — the only way to read one back is the guarded admin route.
    const key = isPrivate ? `proofs/${filename}` : `/uploads/${filename}`;

    return NextResponse.json({
      success: true,
      data: {
        key,
        url: isPrivate ? null : publicUrlForFile(filename),
        mimeType: STORED_MIME_TYPE,
        width: normalised.info.width,
        height: normalised.info.height,
        purpose,
      },
    });
  } catch (error) {
    console.error("[POST /api/upload]", error);
    return failure(500, "SERVER_ERROR", "Failed to upload file.");
  }
}
