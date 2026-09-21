import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bucketForPurpose,
  describeStorage,
  getStorageDriver,
  isReadOnlyFilesystemError,
} from "@/lib/storage";

// The storage driver is what decides whether an operator can publish a drop at
// all: `public/` is read-only on a serverless host, so the wrong choice fails
// only in production. These tests pin the selection rules.
const MANAGED = [
  "STORAGE_PROVIDER",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  "STORAGE_BUCKET_PRODUCTS",
  "STORAGE_BUCKET_BATCHES",
  "LOCAL_UPLOAD_DIR",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of MANAGED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MANAGED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("storage driver selection", () => {
  it("defaults to local disk when nothing is configured", () => {
    const driver = getStorageDriver();
    expect(driver.name).toBe("local");
    expect(driver.isConfigured()).toBe(true);
  });

  it("uses Supabase automatically once its credentials exist", () => {
    // An operator who configured object storage wants it used; making them set a
    // second variable to say so is a foot-gun, not a safeguard.
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";

    const driver = getStorageDriver();
    expect(driver.name).toBe("supabase");
    expect(driver.isConfigured()).toBe(true);
  });

  it("honours an explicit STORAGE_PROVIDER over auto-detection", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    process.env.STORAGE_PROVIDER = "local";

    expect(getStorageDriver().name).toBe("local");
  });

  it("treats a whitespace-only credential as unset", () => {
    process.env.SUPABASE_URL = "   ";
    process.env.SUPABASE_SERVICE_KEY = "  ";
    expect(getStorageDriver().name).toBe("local");
  });

  it("reports supabase as unconfigured when only half of it is set", () => {
    process.env.STORAGE_PROVIDER = "supabase";
    process.env.SUPABASE_URL = "https://example.supabase.co";

    const driver = getStorageDriver();
    expect(driver.name).toBe("supabase");
    // Selected explicitly, but not usable — the health check must say so rather
    // than report a healthy deployment that cannot accept an image.
    expect(driver.isConfigured()).toBe(false);
  });

  it("strips trailing slashes from the Supabase URL", () => {
    process.env.STORAGE_PROVIDER = "supabase";
    process.env.SUPABASE_URL = "https://example.supabase.co///";
    process.env.SUPABASE_SERVICE_KEY = "service-key";

    expect(describeStorage().detail).toContain("https://example.supabase.co (");
  });
});

describe("bucketForPurpose", () => {
  it("gives batch and product imagery separate buckets", () => {
    expect(bucketForPurpose("PRODUCT_IMAGE")).toBe("products");
    expect(bucketForPurpose("BATCH_IMAGE")).toBe("batches");
  });

  it("honours configured bucket names, so an existing deploy needs no rename", () => {
    process.env.STORAGE_BUCKET_PRODUCTS = "shop-products";
    process.env.STORAGE_BUCKET_BATCHES = "shop-drops";

    expect(bucketForPurpose("PRODUCT_IMAGE")).toBe("shop-products");
    expect(bucketForPurpose("BATCH_IMAGE")).toBe("shop-drops");
  });
});

describe("describeStorage", () => {
  it("describes local disk by where it writes", () => {
    const report = describeStorage();
    expect(report.driver).toBe("local");
    expect(report.configured).toBe(true);
    expect(report.detail).toContain("uploads");
  });
});

describe("isReadOnlyFilesystemError", () => {
  it("recognises the errors a read-only host raises", () => {
    for (const code of ["EROFS", "EACCES", "EPERM"]) {
      expect(isReadOnlyFilesystemError({ code })).toBe(true);
    }
  });

  it("does not mistake anything else for a storage problem", () => {
    for (const error of [{ code: "ENOENT" }, new Error("boom"), null, undefined, "nope"]) {
      expect(isReadOnlyFilesystemError(error)).toBe(false);
    }
  });
});
