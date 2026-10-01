import sharp from "sharp";
import {
  HERO_HEIGHT,
  HERO_WIDTH,
  IMAGE_WIDTHS,
  heightForWidth,
  type ImageWidth,
} from "@/lib/image-geometry";

export const MAX_INPUT_PIXELS = 50_000_000;

export const STORED_WEBP_QUALITY = 82;

const READ_OPTIONS = {
  failOn: "error",
  limitInputPixels: MAX_INPUT_PIXELS,
} as const;

export interface ImageRung {
  width: ImageWidth;
  height: number;
  bytes: Buffer;
}

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
