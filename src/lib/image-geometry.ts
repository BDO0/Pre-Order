
export const HERO_WIDTH = 1320;
export const HERO_HEIGHT = 1650;

export const IMAGE_WIDTHS = [400, 800, 1320] as const;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];

export const STORED_IMAGE_EXTENSION = ".webp";
export const STORED_IMAGE_MIME_TYPE = "image/webp";

const DERIVATIVE_PATTERN = new RegExp(
  `-${HERO_WIDTH}${STORED_IMAGE_EXTENSION.replace(/\./g, "\\.")}$`
);

export function imageFilename(base: string, width: ImageWidth): string {
  return `${base}-${width}${STORED_IMAGE_EXTENSION}`;
}

export function heightForWidth(width: number): number {
  return Math.round((width * HERO_HEIGHT) / HERO_WIDTH);
}

export function imageSrcSet(url: string | null | undefined): string | undefined {
  if (typeof url !== "string") return undefined;
  const match = DERIVATIVE_PATTERN.exec(url);
  if (!match) return undefined;
  const base = url.slice(0, match.index);
  return IMAGE_WIDTHS.map((width) => `${base}-${width}${STORED_IMAGE_EXTENSION} ${width}w`).join(", ");
}

export function imageUrlAtWidth(url: string, width: ImageWidth): string {
  const match = DERIVATIVE_PATTERN.exec(url);
  if (!match) return url;
  return `${url.slice(0, match.index)}-${width}${STORED_IMAGE_EXTENSION}`;
}

export const HERO_SIZES = "(max-width: 640px) 92vw, 480px";
export const CARD_SIZES = "(max-width: 640px) 46vw, 300px";
