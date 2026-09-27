import { NextRequest, NextResponse } from "next/server";
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
  isUploadPurpose,
} from "@/lib/uploads";
import { getStorageDriver, isReadOnlyFilesystemError } from "@/lib/storage";
export const dynamic = "force-dynamic";
const MAX_INPUT_PIXELS = 50_000_000;
const PURPOSE_PERMISSION = {
  PRODUCT_IMAGE: "products.write",
  BATCH_IMAGE: "batches.write",
} as const;
function failure(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}
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
    const rawPurpose = formData.get("purpose");
    if (!isUploadPurpose(rawPurpose)) {
      return failure(400, "INVALID_PURPOSE", "Unknown upload purpose.");
    }
    const purpose = rawPurpose;
    const guard = await requirePermission(PURPOSE_PERMISSION[purpose], request);
    if (!guard.ok) return guard.response;
    if (file.size > MAX_UPLOAD_BYTES) {
      return failure(400, "FILE_TOO_LARGE", "File must be less than 25MB.");
    }
    if (file.size === 0) {
      return failure(400, "EMPTY_FILE", "The uploaded file is empty.");
    }
    const input = Buffer.from(await file.arrayBuffer());
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
      .rotate()
      .resize({
        width: MAX_STORED_DIMENSION,
        height: MAX_STORED_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 88, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    const filename = `${randomBytes(16).toString("hex")}${STORED_EXTENSION}`;
    const driver = getStorageDriver();
    try {
      const stored = await driver.save({
        filename,
        bytes: normalised.data,
        contentType: STORED_MIME_TYPE,
        purpose,
      });
      return NextResponse.json({
        success: true,
        data: {
          key: stored.key,
          url: stored.url,
          mimeType: STORED_MIME_TYPE,
          width: normalised.info.width,
          height: normalised.info.height,
          purpose,
          storage: stored.driver,
        },
      });
    } catch (error) {
      if (isReadOnlyFilesystemError(error)) {
        console.error("[POST /api/upload] read-only filesystem", error);
        return failure(
          503,
          "STORAGE_UNAVAILABLE",
          "This deployment cannot store files on local disk. Set STORAGE_PROVIDER=supabase with SUPABASE_URL and SUPABASE_SERVICE_KEY (see docs/DEPLOYMENT.md)."
        );
      }
      if (driver.name === "supabase") {
        console.error("[POST /api/upload] object storage failed", error);
        return failure(
          502,
          "STORAGE_UNAVAILABLE",
          "Object storage rejected the upload. Check that the bucket exists and is public, and that the service key is valid."
        );
      }
      throw error;
    }
  } catch (error) {
    console.error("[POST /api/upload]", error);
    return failure(500, "SERVER_ERROR", "Failed to upload file.");
  }
}
