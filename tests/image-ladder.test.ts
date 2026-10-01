import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { HERO_HEIGHT, HERO_WIDTH, IMAGE_WIDTHS } from "@/lib/image-geometry";
import { renderProductLadder } from "@/lib/image-ladder";

// The upload pipeline is the one place a mistake stays silent: the route answers
// 200, the product record looks complete, and only the storefront shows the
// damage — as a photo cropped through the model's head, or four times heavier
// than the screen needs. These tests run the real sharp chain over real bytes so
// the geometry is proven rather than assumed.

/** A photo-shaped fixture: a dark field with an off-centre bright subject. */
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
      // Every rung has to share the frame, or the storefront's fixed 4:5 box
      // would fill at one breakpoint and letterbox at another.
      expect(rung.height / rung.width).toBeCloseTo(HERO_HEIGHT / HERO_WIDTH, 3);
    }
  });

  it("reshapes a landscape photo instead of padding it with empty bands", async () => {
    // This is the case the crop exists for. object-fit: contain would leave a
    // wide shot floating in a portrait frame, so the pipeline must actually
    // reshape the pixels.
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
