import { describe, expect, it } from "vitest";
import { formatFileSize, heifUploadHint } from "@/lib/client-image-compression";

/** The only part of `File` the hint looks at, so tests need nothing else. */
function pick(name: string, type: string): File {
  return { name, type } as File;
}

describe("heifUploadHint", () => {
  it("flags the HEIC mime type phones report", () => {
    expect(heifUploadHint(pick("IMG_0042.HEIC", "image/heic"))).toContain("Most Compatible");
    expect(heifUploadHint(pick("photo", "image/heif"))).toContain("Most Compatible");
    expect(heifUploadHint(pick("live", "image/heic-sequence"))).toContain("Most Compatible");
  });

  it("flags a HEIC filename even when the browser sends no type", () => {
    // Some pickers hand over an empty `type`, which is exactly the case that used
    // to reach the server and come back as a generic upload failure.
    expect(heifUploadHint(pick("IMG_0042.heic", ""))).toContain("Most Compatible");
    expect(heifUploadHint(pick("IMG_0042.HEIF", "application/octet-stream"))).toContain(
      "Most Compatible"
    );
  });

  it("stays quiet for formats every browser can read", () => {
    expect(heifUploadHint(pick("IMG_0042.JPG", "image/jpeg"))).toBeNull();
    expect(heifUploadHint(pick("shot.png", "image/png"))).toBeNull();
    expect(heifUploadHint(pick("shot.webp", "image/webp"))).toBeNull();
    expect(heifUploadHint(pick("scan.pdf", "application/pdf"))).toBeNull();
  });
});

describe("formatFileSize", () => {
  it("keeps the sizes the admin sees readable", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(900)).toBe("900 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.00 MB");
  });
});
