import sharp from "sharp";
import {
  HERO_HEIGHT,
  HERO_WIDTH,
  IMAGE_WIDTHS,
  heightForWidth,
  type ImageWidth,
} from "@/lib/image-geometry";

/**
 * Refuse to allocate more than 50 megapixels. A small file can decode to a huge
 * bitmap, so this is the guard that stops a decompression bomb exhausting the
 * process, and every sharp pass in the upload pipeline reads through it.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

/**
 * Matches the browser helper's default quality. The server re-encodes only
 * because it is cropping, so this is not the redundant lossy generation it used
 * to be: it is the pass that produces the crop the storefront depends on.
 */
export const STORED_WEBP_QUALITY = 82;

const READ_OPTIONS = {
  // Fail loudly on a corrupt file rather than emitting a half-decoded image.
  failOn: "error",
  limitInputPixels: MAX_INPUT_PIXELS,
} as const;

export interface ImageRung {
  width: ImageWidth;
  height: number;
  bytes: Buffer;
}

/**
 * Crop an uploaded photo to the one frame the storefront is built around, then
 * emit the responsive ladder, widest rung first.
 *
 * `position: "attention"` is the load-bearing choice here. Sharp runs subject
 * detection and crops around what it finds rather than around the centre, and
 * that is the only strategy that survives a mixed library: the centre of a
 * flat-lay is usually the middle of the garment, while the centre of a
 * full-length on-model shot is usually a belt or a hand.
 *
 * The widest rung comes first because it is the canonical URL stored on the
 * product record; `imageSrcSet` derives every other rung from it.
 */
export async function renderProductLadder(input: Buffer): Promise<ImageRung[]> {
  const master = await sharp(input, READ_OPTIONS)
    .rotate()
    .resize({
      width: HERO_WIDTH,
      height: HERO_HEIGHT,
      fit: "cover",
      position: "attention",
    })
    .webp({ quality: STORED_WEBP_QUALITY, effort: 4 })
    .toBuffer();

  const rungs: ImageRung[] = [];
  for (const width of [...IMAGE_WIDTHS].sort((a, b) => b - a)) {
    const height = heightForWidth(width);
    const bytes =
      width === HERO_WIDTH
        ? master
        : await sharp(master, READ_OPTIONS)
            .resize({ width, height })
            .webp({ quality: STORED_WEBP_QUALITY, effort: 4 })
            .toBuffer();
    rungs.push({ width, height, bytes });
  }

  return rungs;
}
