/**
 * Store identity, in one place.
 *
 * Everything here is configuration rather than a literal, because the same
 * values appear in metadata, in the Open Graph card, in the customer-facing
 * "how this works" copy and in links — and a shop that renames itself should
 * not have to find four copies of its own name.
 */

export const SITE_NAME = "TudungPeople PH";
export const SITE_TAGLINE = "Limited pre-order drops";

/** What the shop does, in the words a first-time visitor needs. */
export const SITE_DESCRIPTION =
  "Limited pre-order drops from TudungPeople PH. Reserve your pieces before they are made — we confirm every order personally on Instagram.";

/**
 * The Instagram account that runs the shop.
 *
 * Long-standing drops were settled in DMs before this app existed, so the
 * handle is the most important piece of trust copy on the site: it is where the
 * customer verifies they are talking to the real shop.
 */
export const SHOP_INSTAGRAM_HANDLE =
  process.env.NEXT_PUBLIC_INSTAGRAM_HANDLE?.trim().replace(/^@/, "") || "tudungpeople PH";

export const SHOP_INSTAGRAM_URL =
  process.env.NEXT_PUBLIC_INSTAGRAM_URL ||
  `https://instagram.com/${SHOP_INSTAGRAM_HANDLE.toLowerCase().replace(/\s+/g, "")}`;

/** How long an order holds its stock before the shop expects a DM. */
export const HOLD_FOR_PAYMENT_DAYS = 2;

/**
 * The public origin, used to build absolute URLs.
 *
 * `metadataBase` needs it: an Open Graph image must be an absolute URL, or every
 * platform silently drops the card. Vercel exposes its own deployment hostname
 * when APP_URL has not been set, and localhost is the honest last resort.
 */
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

/** The default social card, for pages without a batch cover image. */
export function defaultOgImageUrl(): string {
  return "/api/og/site";
}

/**
 * The social card for one batch (one pre-order drop).
 *
 * The route is `/api/og/batch/[slug]`. This helper used to point at
 * `/api/og/campaign/<slug>`, which no route has ever served — so anything that
 * finally wired it up would have produced a 404 for the share card. The name is
 * Batch for the same reason the rest of the code says Batch.
 */
export function batchOgImageUrl(slug: string): string {
  return `/api/og/batch/${encodeURIComponent(slug)}`;
}
