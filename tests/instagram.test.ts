import { describe, expect, it } from "vitest";
import {
  INSTAGRAM_HANDLE_PATTERN,
  formatInstagramHandle,
  instagramProfileUrl,
  isNormalisedHandle,
  normaliseInstagramHandle,
} from "@/lib/instagram";

describe("normaliseInstagramHandle", () => {
  it("lowercases and strips the leading @", () => {
    expect(normaliseInstagramHandle("@JuanDC")).toBe("juandc");
    expect(normaliseInstagramHandle("juandc")).toBe("juandc");
    expect(normaliseInstagramHandle("  JUANDC  ")).toBe("juandc");
    expect(normaliseInstagramHandle("@@juandc")).toBe("juandc");
  });

  it("accepts a pasted profile URL, because that is what people paste", () => {
    expect(normaliseInstagramHandle("https://instagram.com/juandc")).toBe("juandc");
    expect(normaliseInstagramHandle("http://www.instagram.com/JuanDC/")).toBe("juandc");
    expect(normaliseInstagramHandle("instagram.com/juandc?hl=en")).toBe("juandc");
  });

  it("keeps periods and underscores, which are legal in a handle", () => {
    expect(normaliseInstagramHandle("@juan.dc_01")).toBe("juan.dc_01");
  });

  it("rejects anything that is not a handle", () => {
    for (const value of [
      "",
      "   ",
      "@",
      "juan dc", 
      "juan-dc", 
      "juan@dc", 
      "a".repeat(31), 
      "juan/dc",
      "🎉",
    ]) {
      expect(normaliseInstagramHandle(value)).toBeNull();
    }
  });

  it("rejects non-strings outright", () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(normaliseInstagramHandle(value)).toBeNull();
    }
  });

  it("accepts the longest legal handle and no longer", () => {
    expect(normaliseInstagramHandle("a".repeat(30))).toBe("a".repeat(30));
    expect(normaliseInstagramHandle("a".repeat(31))).toBeNull();
  });

  it("is idempotent, so a stored value can be re-normalised safely", () => {
    for (const input of ["@JuanDC", "instagram.com/juan.dc", "  JUAN.DC "]) {
      const once = normaliseInstagramHandle(input);
      expect(once).not.toBeNull();
      expect(normaliseInstagramHandle(once)).toBe(once);
    }
  });

  it("never returns a value that fails its own pattern", () => {
    for (const input of ["@Ab.C_1", "instagram.com/ab.c_1", "  AB.C_1  "]) {
      const handle = normaliseInstagramHandle(input);
      expect(handle).not.toBeNull();
      expect(INSTAGRAM_HANDLE_PATTERN.test(handle as string)).toBe(true);
    }
  });
});

describe("isNormalisedHandle", () => {
  it("agrees with the normaliser about what is already stored", () => {
    expect(isNormalisedHandle("juandc")).toBe(true);
    expect(isNormalisedHandle("@juandc")).toBe(false);
    expect(isNormalisedHandle("JuanDC")).toBe(false);
    expect(isNormalisedHandle(null)).toBe(false);
  });
});

describe("display helpers", () => {
  it("writes a handle back the way a human expects", () => {
    expect(formatInstagramHandle("juandc")).toBe("@juandc");
  });

  it("builds a profile link that cannot escape the path", () => {
    expect(instagramProfileUrl("juandc")).toBe("https://instagram.com/juandc");
    expect(instagramProfileUrl("a b")).toBe("https://instagram.com/a%20b");
    expect(instagramProfileUrl("a/b")).toBe("https://instagram.com/a%2Fb");
  });
});
