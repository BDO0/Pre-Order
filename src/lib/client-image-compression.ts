import { HERO_HEIGHT } from "@/lib/image-geometry";

export interface CompressionResult {
  file: File;
  originalBytes: number;
  compressedBytes: number;
  savingsPercent: number;
  width: number;
  height: number;
  previewUrl: string;
}

const HEIF_MIME_TYPES = [
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
];

/**
 * HEIC/HEIF is what iPhones and many Androids shoot by default. Safari can
 * usually decode it, but other mobile browsers cannot, and sharp on the server
 * has no HEIF decoder - so the upload dies with a generic "Failed to upload
 * image" that tells the admin nothing. This returns an actionable hint for those
 * files and `null` for every format we can read.
 */
export function heifUploadHint(file: File): string | null {
  const type = (file.type || "").toLowerCase();
  const isHeif =
    HEIF_MIME_TYPES.includes(type) || /\.(heic|heif)$/i.test(file.name || "");
  if (!isHeif) return null;
  return (
    "This photo is HEIC/HEIF, which this browser can't read. " +
    "On iPhone open Settings → Camera → Formats and choose \"Most Compatible\", " +
    "or upload a screenshot of the photo, then try again."
  );
}

export async function compressImageClient(
  file: File,
  options: {
    maxDimension?: number;
    quality?: number;
  } = {}
): Promise<CompressionResult> {
  if (!file.type.startsWith("image/")) {
    return {
      file,
      originalBytes: file.size,
      compressedBytes: file.size,
      savingsPercent: 0,
      width: 0,
      height: 0,
      previewUrl: URL.createObjectURL(file),
    };
  }
  const maxDimension = options.maxDimension ?? HERO_HEIGHT;
  const quality = options.quality ?? 0.82;
  return new Promise((resolve, reject) => {
    // Decode through an object URL rather than a base64 data URL: a 12-48 MP
    // phone photo grows to ~1.4x its size as base64 and iOS Safari runs out of
    // memory decoding it, which is one of the ways "it won't upload on my phone"
    // shows up. An object URL holds no copy of the bytes, and it is released as
    // soon as the pixels are on the canvas.
    const objectUrl = URL.createObjectURL(file);
    const release = () => URL.revokeObjectURL(objectUrl);
    const img = new Image();
    img.onerror = () => {
      release();
      reject(new Error("Failed to decode image"));
    };
    img.onload = () => {
      try {
        let { naturalWidth: width, naturalHeight: height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) {
          return resolve({
            file,
            originalBytes: file.size,
            compressedBytes: file.size,
            savingsPercent: 0,
            width: img.naturalWidth,
            height: img.naturalHeight,
            previewUrl: URL.createObjectURL(file),
          });
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);
        const exportFormat = "image/webp";
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              return resolve({
                file,
                originalBytes: file.size,
                compressedBytes: file.size,
                savingsPercent: 0,
                width,
                height,
                previewUrl: URL.createObjectURL(file),
              });
            }
            const shouldUseCompressed = blob.size < file.size || file.type !== exportFormat;
            const finalBlob = shouldUseCompressed ? blob : file;
            const newFilename = file.name.replace(/\.[^.]+$/, ".webp");
            const compressedFile = new File([finalBlob], newFilename, {
              type: exportFormat,
              lastModified: Date.now(),
            });
            const originalBytes = file.size;
            const compressedBytes = compressedFile.size;
            const savingsPercent = Math.max(
              0,
              Math.round(((originalBytes - compressedBytes) / originalBytes) * 100)
            );
            resolve({
              file: compressedFile,
              originalBytes,
              compressedBytes,
              savingsPercent,
              width,
              height,
              previewUrl: URL.createObjectURL(compressedFile),
            });
          },
          exportFormat,
          quality
        );
      } finally {
        release();
      }
    };
    img.src = objectUrl;
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
