import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  UPLOAD_PURPOSES,
  isSafeStorageKey,
  isUploadPurpose,
  mimeTypeForKey,
  publicUploadDir,
  publicUrlForFile,
} from "@/lib/uploads";

describe("isSafeStorageKey", () => {
  it("accepts the shapes this app writes", () => {
    expect(isSafeStorageKey("/uploads/2f8c9a.webp")).toBe(true);
    expect(isSafeStorageKey("2f8c9a.png")).toBe(true);
    expect(isSafeStorageKey("uploads/2f8c9a.jpg")).toBe(true);
  });

  it("rejects path traversal and absolute paths", () => {
    expect(isSafeStorageKey("../../.env")).toBe(false);
    expect(isSafeStorageKey("uploads/../../.env")).toBe(false);
    expect(isSafeStorageKey("..\\windows\\system32")).toBe(false);
    expect(isSafeStorageKey("C:\\Windows\\win.ini")).toBe(false);
    expect(isSafeStorageKey("/etc/../etc/passwd")).toBe(false);
  });

  it("rejects empty, over-long and control-character keys", () => {
    expect(isSafeStorageKey("")).toBe(false);
    expect(isSafeStorageKey("   ")).toBe(false);
    expect(isSafeStorageKey("a".repeat(201))).toBe(false);
    expect(isSafeStorageKey("uploads/bad\u0000.webp")).toBe(false);
    expect(isSafeStorageKey("uploads/bad\n.webp")).toBe(false);
  });

  it("rejects non-strings", () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(isSafeStorageKey(value)).toBe(false);
    }
  });
});

describe("mimeTypeForKey", () => {
  it("maps the extensions we store", () => {
    expect(mimeTypeForKey("/uploads/x.webp")).toBe("image/webp");
    expect(mimeTypeForKey("/uploads/x.jpg")).toBe("image/jpeg");
    expect(mimeTypeForKey("/uploads/x.jpeg")).toBe("image/jpeg");
    expect(mimeTypeForKey("/uploads/x.PNG")).toBe("image/png");
  });

  it("falls back to a non-renderable type for anything unexpected", () => {
    expect(mimeTypeForKey("x.html")).toBe("application/octet-stream");
    expect(mimeTypeForKey("x")).toBe("application/octet-stream");
  });
});

describe("upload purposes", () => {
  it("recognises only the purposes the API implements", () => {
    for (const purpose of UPLOAD_PURPOSES) {
      expect(isUploadPurpose(purpose)).toBe(true);
    }
    expect(isUploadPurpose("PRODUCT_IMAGE")).toBe(true);
    expect(isUploadPurpose("BATCH_IMAGE")).toBe(true);
    expect(isUploadPurpose("PAYMENT_PROOF")).toBe(false);
    expect(isUploadPurpose("AVATAR")).toBe(false);
    expect(isUploadPurpose("")).toBe(false);
    expect(isUploadPurpose(null)).toBe(false);
  });
});

describe("upload destinations", () => {
  it("keeps every upload inside public/uploads", () => {
    expect(publicUploadDir()).toBe(join(process.cwd(), "public", "uploads"));
  });

  it("returns a root-relative URL, never an absolute path", () => {
    const url = publicUrlForFile("2f8c9a.webp");
    expect(url).toBe("/uploads/2f8c9a.webp");
    expect(url.includes(process.cwd())).toBe(false);
  });
});
