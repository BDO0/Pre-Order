export const SITE_NAME = "TudungPeople PH";
export const SITE_TAGLINE = "Limited pre-order drops";
export const SITE_DESCRIPTION =
  "Limited pre-order drops from TudungPeople PH. Reserve your pieces before they are made — we confirm every order personally on Instagram.";
export const SHOP_INSTAGRAM_HANDLE =
  process.env.NEXT_PUBLIC_INSTAGRAM_HANDLE?.trim().replace(/^@/, "") || "tudungpeopleph";
export const SHOP_INSTAGRAM_URL =
  process.env.NEXT_PUBLIC_INSTAGRAM_URL ||
  `https://instagram.com/${SHOP_INSTAGRAM_HANDLE.toLowerCase().replace(/\s+/g, "")}`;
export interface ShopSocial {
  label: string;
  handle: string;
  url: string;
}

export const SHOP_SOCIALS: readonly ShopSocial[] = [
  { label: "Instagram", handle: `@${SHOP_INSTAGRAM_HANDLE}`, url: SHOP_INSTAGRAM_URL },
  {
    label: "Facebook",
    handle: "TudungPeople PH",
    url:
      process.env.NEXT_PUBLIC_FACEBOOK_URL ||
      "https://www.facebook.com/p/TudungPeople-PH-100087529293348/",
  },
  {
    label: "Tiktok",
    handle: "@TudungPeoplePH",
    url: process.env.NEXT_PUBLIC_TIKTOK_URL || "https://www.tiktok.com/@tudungpeopleph",
  },
];
export const HOLD_FOR_PAYMENT_DAYS = 2;
export function siteUrl(): URL {
  const configured =
    process.env.APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : undefined);
  try {
    return new URL(configured ?? "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}
export function defaultOgImageUrl(): string {
  return "/api/og/site";
}
export function batchOgImageUrl(slug: string): string {
  return `/api/og/batch/${encodeURIComponent(slug)}`;
}
