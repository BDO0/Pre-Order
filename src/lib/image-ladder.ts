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
  const { data: rawMaster, info } = await sharp(input, READ_OPTIONS)
    .rotate()
    .resize({
      width: HERO_WIDTH,
      height: HERO_HEIGHT,
      fit: "cover",
      position: "attention",
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const sortedWidths = [...IMAGE_WIDTHS].sort((a, b) => b - a);
  const rawInput = {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  } as const;

  return Promise.all(
    sortedWidths.map(async (width) => {
      const height = heightForWidth(width);
      const pipeline = sharp(rawMaster, rawInput);
      const resized =
        width === HERO_WIDTH ? pipeline : pipeline.resize({ width, height });
      const bytes = await resized
        .webp({ quality: STORED_WEBP_QUALITY, effort: 2 })
        .toBuffer();
      return { width, height, bytes };
    })
  );
}
