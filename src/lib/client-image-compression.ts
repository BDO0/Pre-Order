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
  // Sized to the hero frame's longest edge, not a round number. The server
  // crops to 4:5 at 1320x1650 with `fit: "cover"`, so a portrait photo needs at
  // least 1650px of height on its way up or the crop would have to enlarge it.
  const maxDimension = options.maxDimension ?? HERO_HEIGHT;
  const quality = options.quality ?? 0.82;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Failed to decode image"));
      img.onload = () => {
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
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
