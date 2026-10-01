// Geometry and URL conventions for stored imagery.
//
// This module is deliberately dependency-free. The upload route (Node) and the
// storefront (browser) both need these numbers, and anything importing `node:*`
// cannot cross that boundary. Sharing them is what lets the hero render a
// correct box on the very first paint instead of measuring an image in
// JavaScript once it has loaded.

/**
 * Every product image is cropped to exactly this box at upload, so the ratio is
 * a constant to read rather than a fact to discover at runtime. 4:5 portrait is
 * the format Instagram and most fashion storefronts use.
 */
export const HERO_WIDTH = 1320;
export const HERO_HEIGHT = 1650;

/**
 * The widths produced for every product upload, smallest first. One file per
 * band beats one file for every screen: a 360pt grid tile on a 2x phone needs
 * ~720px of pixels, not 1320px of bytes.
 */
export const IMAGE_WIDTHS = [400, 800, 1320] as const;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];

export const STORED_IMAGE_EXTENSION = ".webp";
export const STORED_IMAGE_MIME_TYPE = "image/webp";

/**
 * The widest derivative is the canonical URL stored on the product record. That
 * makes a stored URL self-describing: the smaller siblings are found by swapping
 * the `-1320` suffix, so the ladder needs no column of its own and images
 * uploaded before the ladder existed keep working untouched.
 *
 * The suffix is required exactly, not merely "some digits before .webp". A URL
 * only names a ladder if our upload route named it, and the route only ever
 * writes the widest rung, so anything else is treated as a single file. That is
 * the fail-closed direction: emitting a srcset for a URL with no siblings on
 * disk would make the browser fetch a file that does not exist.
 */
const DERIVATIVE_PATTERN = new RegExp(
  `-${HERO_WIDTH}${STORED_IMAGE_EXTENSION.replace(/\./g, "\\.")}$`
);

/** `<base>-<width>.webp`, e.g. `9f3c1a…-400.webp`. */
export function imageFilename(base: string, width: ImageWidth): string {
  return `${base}-${width}${STORED_IMAGE_EXTENSION}`;
}

/** Absolute height that keeps a derivative inside the 4:5 frame (400 -> 500). */
export function heightForWidth(width: number): number {
  return Math.round((width * HERO_HEIGHT) / HERO_WIDTH);
}

/**
 * Turn a stored image URL into a `srcset`, or `undefined` for anything that is
 * not one of our ladders — a pre-ladder upload, an absolute URL from another
 * host, or an empty slot. Callers can hand the result straight to `srcSet`;
 * `undefined` just omits the attribute and the browser uses `src`.
 */
export function imageSrcSet(url: string | null | undefined): string | undefined {
  if (typeof url !== "string") return undefined;
  const match = DERIVATIVE_PATTERN.exec(url);
  if (!match) return undefined;
  const base = url.slice(0, match.index);
  return IMAGE_WIDTHS.map((width) => `${base}-${width}${STORED_IMAGE_EXTENSION} ${width}w`).join(", ");
}

/**
 * Rewrite a stored URL to a specific rung of the ladder. Falls back to the
 * original URL so callers never have to test for the ladder's presence — a
 * pre-ladder image simply renders at its only size.
 */
export function imageUrlAtWidth(url: string, width: ImageWidth): string {
  const match = DERIVATIVE_PATTERN.exec(url);
  if (!match) return url;
  return `${url.slice(0, match.index)}-${width}${STORED_IMAGE_EXTENSION}`;
}

/**
 * `sizes` hints matching the two places product imagery actually appears. The
 * hero is capped at 62dvh tall in CSS, which at 4:5 is never wider than ~480px;
 * grid tiles are roughly a 300px column.
 */
export const HERO_SIZES = "(max-width: 640px) 92vw, 480px";
export const CARD_SIZES = "(max-width: 640px) 46vw, 300px";
