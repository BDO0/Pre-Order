import { describe, expect, it } from "vitest";
import {
  SHOP_INSTAGRAM_HANDLE,
  SHOP_INSTAGRAM_URL,
  SITE_NAME,
  siteUrl,
} from "@/lib/site";

describe("site configuration", () => {
  it("exports a non-empty site name", () => {
    expect(SITE_NAME).toBeTypeOf("string");
    expect(SITE_NAME.length).toBeGreaterThan(0);
  });

  it("exports the shop instagram handle as a clean string without the @", () => {
    expect(SHOP_INSTAGRAM_HANDLE).toBeTypeOf("string");
    expect(SHOP_INSTAGRAM_HANDLE.startsWith("@")).toBe(false);
  });

  it("builds the correct instagram URL", () => {
    expect(SHOP_INSTAGRAM_URL).toBe(
      `https://instagram.com/${SHOP_INSTAGRAM_HANDLE.toLowerCase().replace(/\s+/g, "")}`
    );
  });

  describe("siteUrl", () => {
    const originalAppUrl = process.env.APP_URL;

    it("respects APP_URL when set", () => {
      process.env.APP_URL = "https://custom.example.com";
      expect(siteUrl().origin).toBe("https://custom.example.com");
      process.env.APP_URL = originalAppUrl; 
    });
  });
});
