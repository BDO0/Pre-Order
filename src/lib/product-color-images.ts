/**
 * Per-colour product images.
 *
 * A product carries one default gallery (`Product.images`). Colour options may
 * each have their own gallery, stored as `ProductColorImage` rows. Everything in
 * this file is the pure half of the feature: it normalises colour labels, builds
 * the lookup the storefront reads, resolves the gallery to show for a selection,
 * and plans the writes the admin form implies.
 *
 * Rules that matter downstream:
 *
 * - Colour options are identified by `normalizeColorKey`, not by variant id.
 *   `variant-plan.ts` retires and recreates a variant when its colour or size
 *   label changes, so an image stored against a variant id would disappear on a
 *   rename. Keying by label survives that.
 * - A colour with no rows of its own falls back to the product's default
 *   gallery. That is the whole point of the feature: the storefront never has to
 *   know whether an image exists, it only asks which gallery to render.
 * - `/lib/variant-stock.ts` buckets a missing colour as "Standard" for reporting.
 *   That is a display label, not a key: here a missing colour normalises to "",
 *   the same bucket `variantKey` uses.
 */

/** How many images a single colour may carry. Keeps the admin form honest. */
export const MAX_IMAGES_PER_COLOR = 6;

/** Hard cap on rows a single product may store, matching the request schema. */
export const MAX_COLOR_IMAGE_ROWS = 200;

/**
 * Longest colour label we accept.
 *
 * Deliberately the same cap `productVariantWriteSchema.color` enforces, because
 * the two have to agree: a colour image's `colorKey` is the normalised label, and
 * a variant's `color` is looked up by that same key. A shorter cap here would
 * truncate the image label and silently detach the gallery from its variant.
 */
export const MAX_COLOR_LABEL_LENGTH = 200;

export interface ColorImageRow {
  colorKey: string;
  colorLabel: string;
  url: string;
  sortOrder: number;
}

/** Rows as they come back from Prisma, without the columns we do not need. */
export interface StoredColorImageRow {
  id: string;
  colorKey: string;
  colorLabel: string;
  url: string;
  sortOrder: number;
}

/** What the admin form submits for one colour image. */
export interface IncomingColorImage {
  color?: string | null;
  url: string;
  sortOrder?: number | null;
}

/** `colorKey` => ordered image URLs. Missing key means "use the default gallery". */
export type ColorImageMap = Record<string, string[]>;

/**
 * The identity of a colour option. Trimmed and lowercased so " Black" and
 * "black" are the same option, and blank or `null` collapse to "" - the same
 * bucket `variantKey(null, size)` produces for products without colours.
 */
export function normalizeColorKey(color: string | null | undefined): string {
  return (color ?? "").trim().toLowerCase();
}

/** The label to store alongside a key: trimmed, but otherwise as typed. */
export function normalizeColorLabel(color: string | null | undefined): string {
  return (color ?? "").trim().slice(0, MAX_COLOR_LABEL_LENGTH);
}

function cleanUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Turns stored rows into the lookup the storefront renders from. Rows are
 * ordered by `sortOrder`, so the first URL for a colour is its primary image.
 * Blank URLs and duplicate URLs within a colour are dropped rather than shown
 * as broken images.
 */
export function buildColorImageMap(
  rows: readonly { colorKey: string; url: string; sortOrder?: number | null }[] | undefined
): ColorImageMap {
  const map: ColorImageMap = {};
  if (!rows || rows.length === 0) return map;

  const ordered = [...rows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  for (const row of ordered) {
    const url = cleanUrl(row.url);
    if (!url) continue;
    const key = normalizeColorKey(row.colorKey);
    const list = map[key] ?? [];
    if (list.includes(url)) continue;
    list.push(url);
    map[key] = list;
  }
  return map;
}

export interface ColorImageHolder {
  images?: readonly string[] | null;
  colorImages?: ColorImageMap | null;
}

/**
 * The first gallery a product has at all, chosen deterministically by colour key.
 *
 * Only used when a product has no default gallery: a product photographed
 * colour-by-colour leaves `Product.images` empty, and rendering nothing until the
 * shopper happens to click a colour would hide it from the grid, the hero and its
 * social preview. Sorting the keys keeps that choice stable for every visitor.
 */
function firstColorGallery(
  colorImages: ColorImageMap | null | undefined
): string[] {
  if (!colorImages) return [];
  for (const key of Object.keys(colorImages).sort()) {
    const own = colorImages[key];
    if (own && own.length > 0) return own;
  }
  return [];
}

/**
 * The gallery to show for a colour selection.
 *
 * Returns the colour's own images when it has any, and the product's default
 * gallery otherwise - including when no colour is selected yet, when the
 * selected colour has no images, and when the product has no colours at all. A
 * product with no default gallery falls back to its first colour's gallery
 * instead, so a colour-photographed product is never blank.
 */
export function imagesForColor(
  product: ColorImageHolder | null | undefined,
  color: string | null | undefined
): string[] {
  const fallback = (product?.images ?? []).filter(
    (url): url is string => typeof url === "string" && url !== ""
  );
  const key = normalizeColorKey(color);
  if (key !== "") {
    const own = product?.colorImages?.[key];
    if (own && own.length > 0) return own;
  }
  if (fallback.length > 0) return fallback;
  return firstColorGallery(product?.colorImages);
}

/** The one image to hand to a cart line, thumbnail or social preview. */
export function primaryImageForColor(
  product: ColorImageHolder | null | undefined,
  color: string | null | undefined
): string | null {
  return imagesForColor(product, color)[0] ?? null;
}

/** True when this colour has its own gallery rather than borrowing the default. */
export function colorHasOwnImages(
  product: ColorImageHolder | null | undefined,
  color: string | null | undefined
): boolean {
  const key = normalizeColorKey(color);
  if (key === "") return false;
  const own = product?.colorImages?.[key];
  return Boolean(own && own.length > 0);
}

export interface ColorImageCoverage {
  /** Distinct colour options the product offers. */
  total: number;
  /** How many of them have their own image. */
  covered: number;
  /** Colour keys still falling back to the default gallery. */
  missing: string[];
}

/**
 * How much of a product's colour range has its own photography. Used by the
 * admin list so it is obvious which products still need uploads.
 */
export function colorImageCoverage(
  variants: readonly { color?: string | null; active?: boolean }[] | undefined,
  colorImages: ColorImageMap | null | undefined
): ColorImageCoverage {
  const keys = new Set<string>();
  for (const variant of variants ?? []) {
    if (variant.active === false) continue;
    const key = normalizeColorKey(variant.color);
    if (key === "") continue;
    keys.add(key);
  }
  const missing = [...keys].filter((key) => !(colorImages?.[key]?.length ?? 0));
  return { total: keys.size, covered: keys.size - missing.length, missing };
}

export interface ColorImageSyncPlan {
  create: ColorImageRow[];
  update: { id: string; url: string; colorLabel: string }[];
  remove: string[];
}

function slotKey(color: string | null | undefined, sortOrder: number | null | undefined): string {
  return `${normalizeColorKey(color)}|${sortOrder ?? 0}`;
}

/**
 * Works out the row-level writes for a save.
 *
 * Semantics the admin form relies on:
 *
 * - A submitted colour is authoritative: its rows become exactly the images
 *   submitted for it, so removing one image from a colour's gallery is just
 *   "submit the colour with one fewer image".
 * - `removeKeys` deletes a colour's rows entirely, and wins over a submitted
 *   image for the same colour.
 * - Colours that were neither submitted nor removed are left alone. That is what
 *   lets an admin retire a colour from the matrix (which retires its variants)
 *   and later add it back with its photos still attached.
 */
export function planColorImageSync(
  existing: readonly StoredColorImageRow[],
  incoming: readonly IncomingColorImage[],
  removeKeys: readonly string[] = []
): ColorImageSyncPlan {
  const plan: ColorImageSyncPlan = { create: [], update: [], remove: [] };

  const removed = new Set(
    removeKeys.map((key) => normalizeColorKey(key)).filter((key) => key !== "")
  );

  const wanted = new Map<string, ColorImageRow>();
  for (const entry of incoming) {
    const url = cleanUrl(entry.url);
    if (!url) continue;
    const colorKey = normalizeColorKey(entry.color);
    // An explicit removal outranks an image submitted for the same colour: the
    // two together are a contradiction, and deleting is the safer reading.
    if (removed.has(colorKey)) continue;
    const sortOrder = entry.sortOrder ?? 0;
    wanted.set(slotKey(entry.color, sortOrder), {
      colorKey,
      colorLabel: normalizeColorLabel(entry.color),
      url,
      sortOrder,
    });
  }
  const submittedKeys = new Set(Array.from(wanted.values(), (row) => row.colorKey));

  const bySlot = new Map<string, StoredColorImageRow[]>();
  for (const row of existing) {
    const key = normalizeColorKey(row.colorKey);
    if (removed.has(key)) {
      plan.remove.push(row.id);
      continue;
    }
    const slot = slotKey(row.colorKey, row.sortOrder);
    if (submittedKeys.has(key) && !wanted.has(slot)) {
      // The colour was submitted without this slot: it is gone.
      plan.remove.push(row.id);
      continue;
    }
    const list = bySlot.get(slot) ?? [];
    list.push(row);
    bySlot.set(slot, list);
  }

  for (const [key, row] of wanted) {
    const survivors = bySlot.get(key) ?? [];
    if (survivors.length === 0) {
      plan.create.push(row);
      continue;
    }
    const [keep, ...duplicates] = survivors;
    if (keep.url !== row.url || keep.colorLabel !== row.colorLabel) {
      plan.update.push({ id: keep.id, url: row.url, colorLabel: row.colorLabel });
    }
    // Duplicate slots can only exist if a write raced past the unique index;
    // clearing them keeps `buildColorImageMap` deterministic.
    plan.remove.push(...duplicates.map((duplicate) => duplicate.id));
  }

  return plan;
}

/** The rows to insert for a brand new product (first turn, never a diff). */
export function colorImageCreateRows(incoming: readonly IncomingColorImage[]): ColorImageRow[] {
  const seen = new Set<string>();
  const rows: ColorImageRow[] = [];
  for (const entry of incoming) {
    const url = cleanUrl(entry.url);
    if (!url) continue;
    const sortOrder = entry.sortOrder ?? 0;
    const key = slotKey(entry.color, sortOrder);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      colorKey: normalizeColorKey(entry.color),
      colorLabel: normalizeColorLabel(entry.color),
      url,
      sortOrder,
    });
  }
  return rows;
}

/** One colour's gallery as the admin form holds it, before it becomes rows. */
export interface ColorImageDraft {
  /** The colour exactly as the admin typed it in the variant list. */
  color: string;
  /** Ordered uploaded URLs. Empty means "fall back to the default gallery". */
  urls: readonly string[];
}

/**
 * Flattens the editor's drafts into the request body's `colorImages` list.
 *
 * Slot numbers come from array position, so the first image a colour shows is
 * the first one the admin uploaded. Blank URLs are dropped instead of being sent
 * to be rejected.
 */
export function colorImagePayload(drafts: readonly ColorImageDraft[]): IncomingColorImage[] {
  const rows: IncomingColorImage[] = [];
  for (const draft of drafts) {
    const color = normalizeColorLabel(draft.color);
    if (color === "") continue;
    draft.urls.slice(0, MAX_IMAGES_PER_COLOR).forEach((url, sortOrder) => {
      const cleaned = cleanUrl(url);
      if (cleaned) rows.push({ color, url: cleaned, sortOrder });
    });
  }
  return rows;
}

/**
 * Groups stored rows back into editor drafts.
 *
 * The edit form has to start from what is already saved, and it wants one card
 * per colour with that colour's images in display order. Rows arrive ordered by
 * `colorKey` then `sortOrder`, but sorting here keeps the function honest for any
 * caller and lets a colour's label be whatever the first row says.
 */
export function colorImageDraftsFromRows(
  rows:
    | readonly {
        colorKey?: string | null;
        colorLabel?: string | null;
        url: string;
        sortOrder?: number | null;
      }[]
    | undefined
): ColorImageDraft[] {
  if (!rows || rows.length === 0) return [];

  const byKey = new Map<string, { color: string; urls: string[] }>();
  const order: string[] = [];
  for (const row of [...rows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    const url = cleanUrl(row.url);
    const color = normalizeColorLabel(row.colorLabel ?? row.colorKey ?? "");
    if (!url || color === "") continue;
    const key = normalizeColorKey(row.colorKey ?? color);
    let entry = byKey.get(key);
    if (!entry) {
      entry = { color, urls: [] };
      byKey.set(key, entry);
      order.push(key);
    }
    if (!entry.urls.includes(url)) entry.urls.push(url);
  }

  const drafts: ColorImageDraft[] = [];
  for (const key of order) {
    const entry = byKey.get(key);
    if (entry) drafts.push(entry);
  }
  return drafts;
}

/**
 * Stored colours whose whole gallery the admin cleared.
 *
 * Emptying a colour's draft alone would leave its rows in place (an absent colour
 * means "leave alone", which is what keeps a retired colour's photos around), so
 * the form has to name them in `removeColorImages` to actually delete them.
 */
export function clearedColorLabels(
  storedColors: readonly string[],
  drafts: readonly ColorImageDraft[]
): string[] {
  const kept = new Set(
    drafts
      .filter((draft) => draft.urls.some((url) => cleanUrl(url) !== null))
      .map((draft) => normalizeColorKey(draft.color))
  );
  const cleared: string[] = [];
  const seen = new Set<string>();
  for (const stored of storedColors) {
    const key = normalizeColorKey(stored);
    if (key === "" || kept.has(key) || seen.has(key)) continue;
    seen.add(key);
    cleared.push(normalizeColorLabel(stored));
  }
  return cleared;
}

