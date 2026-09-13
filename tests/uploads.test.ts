import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  isSafeStorageKey,
  isPrivatePurpose,
  isUploadPurpose,
  mimeTypeForKey,
  proofCandidatesForKey,
} from "@/lib/uploads";

// Storage keys are accepted from the database and from request bodies, and they
// end up in a filesystem call. These tests are the guard rail: a traversal that
// slips through here is an arbitrary file read.
describe("isSafeStorageKey", () => {
  it("accepts the shapes this app writes", () => {
    expect(isSafeStorageKey("proofs/2f8c9a.webp")).toBe(true);
    expect(isSafeStorageKey("/uploads/2f8c9a.jpg")).toBe(true);
    expect(isSafeStorageKey("2f8c9a.png")).toBe(true);
  });

  it("rejects path traversal and absolute paths", () => {
    expect(isSafeStorageKey("../../.env")).toBe(false);
    expect(isSafeStorageKey("proofs/../../.env")).toBe(false);
    expect(isSafeStorageKey("..\\windows\\system32")).toBe(false);
    expect(isSafeStorageKey("C:\\Windows\\win.ini")).toBe(false);
    expect(isSafeStorageKey("/etc/../etc/passwd")).toBe(false);
  });

  it("neutralises a root-looking path by using only its last segment", () => {
    // `/etc/passwd` passes the character check, so the safety has to come from
    // the resolver: it keeps `basename` and joins it under a directory we own.
    // Because the key does not start with `proofs/` it is treated as a legacy
    // key, so both locations are offered — each one still inside our own tree.
    const candidates = proofCandidatesForKey("/etc/passwd");

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate).toContain(process.cwd());
      expect(candidate.endsWith("passwd")).toBe(true);
    }
    expect(candidates[0]).toContain(join("private", "uploads", "proofs"));
  });

  it("rejects empty, over-long and control-character keys", () => {
    expect(isSafeStorageKey("")).toBe(false);
    expect(isSafeStorageKey("   ")).toBe(false);
    expect(isSafeStorageKey("a".repeat(201))).toBe(false);
    expect(isSafeStorageKey("proofs/bad\u0000.webp")).toBe(false);
    expect(isSafeStorageKey("proofs/bad\n.webp")).toBe(false);
  });

  it("rejects non-strings", () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(isSafeStorageKey(value)).toBe(false);
    }
  });
});

describe("mimeTypeForKey", () => {
  it("maps the extensions we store", () => {
    expect(mimeTypeForKey("proofs/x.webp")).toBe("image/webp");
    expect(mimeTypeForKey("/uploads/x.jpg")).toBe("image/jpeg");
    expect(mimeTypeForKey("/uploads/x.jpeg")).toBe("image/jpeg");
    expect(mimeTypeForKey("/uploads/x.PNG")).toBe("image/png");
  });

  it("falls back to a non-renderable type for anything unexpected", () => {
    // Never "text/html": serving an unrecognised file as HTML is how an upload
    // becomes stored XSS.
    expect(mimeTypeForKey("x.html")).toBe("application/octet-stream");
    expect(mimeTypeForKey("x")).toBe("application/octet-stream");
  });
});

describe("upload purposes", () => {
  it("recognises only the purposes the API implements", () => {
    expect(isUploadPurpose("PAYMENT_PROOF")).toBe(true);
    expect(isUploadPurpose("PRODUCT_IMAGE")).toBe(true);
    expect(isUploadPurpose("CAMPAIGN_IMAGE")).toBe(true);
    expect(isUploadPurpose("AVATAR")).toBe(false);
    expect(isUploadPurpose("")).toBe(false);
    expect(isUploadPurpose(null)).toBe(false);
  });

  it("treats only payment proofs as private", () => {
    expect(isPrivatePurpose("PAYMENT_PROOF")).toBe(true);
    expect(isPrivatePurpose("PRODUCT_IMAGE")).toBe(false);
    expect(isPrivatePurpose("CAMPAIGN_IMAGE")).toBe(false);
  });
});

describe("proofCandidatesForKey", () => {
  it("resolves a new key only inside the private proof directory", () => {
    const candidates = proofCandidatesForKey("proofs/abc.webp");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toContain(join("private", "uploads", "proofs"));
    expect(candidates[0].endsWith(join("proofs", "abc.webp"))).toBe(true);
  });

  it("still finds a legacy proof that was written to public/uploads", () => {
    // Rows created before the private split hold `/uploads/x.jpg`. They must
    // keep working without a migration, and the old location is tried second.
    const candidates = proofCandidatesForKey("/uploads/legacy.jpg");
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toContain(join("private", "uploads", "proofs"));
    expect(candidates[1]).toBe(
      join(process.cwd(), "public", "uploads", "legacy.jpg")
    );
  });

  it("returns nothing for an unsafe key, so no filesystem call is made", () => {
    expect(proofCandidatesForKey("../../.env")).toEqual([]);
    expect(proofCandidatesForKey("")).toEqual([]);
  });
});
