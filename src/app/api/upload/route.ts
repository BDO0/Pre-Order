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
import {
  HERO_HEIGHT,
  HERO_WIDTH,
  STORED_IMAGE_MIME_TYPE,
  imageFilename,
} from "@/lib/image-geometry";
import {
  MAX_INPUT_PIXELS,
  STORED_WEBP_QUALITY,
  renderProductLadder,
} from "@/lib/image-ladder";
import { getStorageDriver, isReadOnlyFilesystemError } from "@/lib/storage";
export const dynamic = "force-dynamic";
// Cropping, encoding quality and the decompression-bomb guard all live with the
// ladder itself, in image-ladder.ts, so there is one definition of each.
const PURPOSE_PERMISSION = {
  PRODUCT_IMAGE: "products.write",
  BATCH_IMAGE: "batches.write",
} as const;
function failure(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}
export async function POST(request: NextRequest) {
  try {
    const limited = await enforceRateLimit(request, RATE_LIMITS.upload);
    if (limited) return limited;
    if (!isSameOrigin(request)) {
      return failure(403, "CROSS_ORIGIN_BLOCKED", "This request did not come from this site.");
    }
    // Reject on the declared length BEFORE parsing. request.formData() buffers the
    // entire body into memory, so the per-file check further down runs far too late
    // to protect this process from a large upload. The margin covers multipart
    // boundary and header overhead. Chunked requests have no content-length, so this
    // is a cheap first gate rather than a replacement for the check below.
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES + 64 * 1024) {
      return failure(413, "FILE_TOO_LARGE", "File must be less than 25MB.");
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
    const driver = getStorageDriver();
    const base = randomBytes(16).toString("hex");
    try {
      // Product imagery is cropped to one fixed 4:5 frame and emitted as a small
      // responsive ladder. See image-ladder.ts for the crop strategy. Fixing the
      // ratio at upload is what lets the storefront reserve a correct box on
      // first paint from plain width/height attributes instead of measuring
      // every image in JavaScript once it has loaded.
      if (purpose === "PRODUCT_IMAGE") {
        const rungs = await renderProductLadder(input);
        // The widest rung is the canonical URL. The smaller rungs are found from
        // it by swapping the -1320 suffix, so the stored URL is enough to
        // reconstruct the whole ladder and it needs no column of its own.
        const [canonicalRung, ...smallerRungs] = rungs;
        const canonical = await driver.save({
          filename: imageFilename(base, canonicalRung.width),
          bytes: canonicalRung.bytes,
          contentType: STORED_IMAGE_MIME_TYPE,
          purpose,
        });
        const variants: { width: number; url: string | null }[] = [
          { width: canonicalRung.width, url: canonical.url },
        ];
        for (const rung of smallerRungs) {
          const saved = await driver.save({
            filename: imageFilename(base, rung.width),
            bytes: rung.bytes,
            contentType: STORED_IMAGE_MIME_TYPE,
            purpose,
          });
          variants.push({ width: rung.width, url: saved.url });
        }
        return NextResponse.json({
          success: true,
          data: {
            key: canonical.key,
            url: canonical.url,
            mimeType: STORED_IMAGE_MIME_TYPE,
            width: HERO_WIDTH,
            height: HERO_HEIGHT,
            variants,
            purpose,
            storage: canonical.driver,
          },
        });
      }
      // Drop banners keep their original framing. A wide cover squeezed into a
      // 4:5 box would lose the part of the picture the banner exists to show.
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
        .webp({ quality: STORED_WEBP_QUALITY, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      const stored = await driver.save({
        filename: `${base}${STORED_EXTENSION}`,
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
