import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { HERO_HEIGHT, HERO_WIDTH, IMAGE_WIDTHS } from "@/lib/image-geometry";
import { renderProductLadder } from "@/lib/image-ladder";


async function makePhoto(width: number, height: number): Promise<Buffer> {
  const subject = await sharp({
    create: {
      width: Math.round(width * 0.4),
      height: Math.round(height * 0.6),
      channels: 3,
      background: { r: 244, g: 236, b: 240 },
    },
  })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 43, g: 11, b: 22 },
    },
  })
    .composite([
      {
        input: subject,
        left: Math.round(width * 0.3),
        top: Math.round(height * 0.1),
      },
    ])
    .png()
    .toBuffer();
}

describe("renderProductLadder", () => {
  it("returns one rung per breakpoint, widest first", async () => {
    const rungs = await renderProductLadder(await makePhoto(2000, 3000));
    expect(rungs.map((rung) => rung.width)).toEqual(
      [...IMAGE_WIDTHS].sort((a, b) => b - a)
    );
  });

  it("puts the canonical rung first, because that is the URL that gets stored", async () => {
    const rungs = await renderProductLadder(await makePhoto(2000, 3000));
    expect(rungs[0].width).toBe(HERO_WIDTH);
    expect(rungs[0].height).toBe(HERO_HEIGHT);
  });

  it("crops every rung to the same frame and encodes WebP", async () => {
    const rungs = await renderProductLadder(await makePhoto(2000, 3000));
    for (const rung of rungs) {
      const meta = await sharp(rung.bytes).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(rung.width);
      expect(meta.height).toBe(rung.height);
      expect(rung.height / rung.width).toBeCloseTo(HERO_HEIGHT / HERO_WIDTH, 3);
    }
  });

  it("reshapes a landscape photo instead of padding it with empty bands", async () => {
    const rungs = await renderProductLadder(await makePhoto(3000, 1500));
    const meta = await sharp(rungs[0].bytes).metadata();
    expect(meta.width).toBe(HERO_WIDTH);
    expect(meta.height).toBe(HERO_HEIGHT);
  });

  it("makes the smaller rungs materially lighter, or the srcset would buy nothing", async () => {
    const rungs = await renderProductLadder(await makePhoto(2000, 3000));
    const widest = rungs[0];
    const smallest = rungs[rungs.length - 1];
    expect(smallest.width).toBe(Math.min(...IMAGE_WIDTHS));
    expect(smallest.bytes.length).toBeLessThan(widest.bytes.length);
  });

  it("refuses a buffer that is not an image rather than half-decoding it", async () => {
    await expect(renderProductLadder(Buffer.from("this is not a photo"))).rejects.toBeTruthy();
  });
});
