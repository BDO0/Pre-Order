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
export const MAX_COLOR_IMAGE_ROWS = 400;

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

export interface ColorSwatchStyle {
  bg: string;
  border?: string;
}

/**
 * Canonical hex palette for fashion, modest-wear, and editorial colorways.
 * Multi-word entries are keyed with single spaces (hyphens/underscores normalized).
 */
const FASHION_COLOR_HEX: Record<string, string> = {
  // Whites, Creams & Off-Whites
  white: "#fafafa",
  "off white": "#f4f1ea",
  ivory: "#fffff0",
  cream: "#f5f2e3",
  ecru: "#ebe5d0",
  alabaster: "#f2f0e6",
  pearl: "#eae6df",
  bone: "#e3dac9",
  vanilla: "#f3e5ab",
  porcelain: "#f0efe9",
  milk: "#fdfff5",
  chalk: "#efeee9",
  linen: "#faf0e6",
  oat: "#dfd3c3",
  oatmeal: "#d9cfc1",
  eggshell: "#f0ead6",
  coconut: "#f7f5f0",
  snow: "#fffafa",

  // Beiges, Nudes, Tans & Browns
  beige: "#d4b996",
  nude: "#ddb8a0",
  sand: "#e2d2b5",
  fawn: "#c8a987",
  champagne: "#ead6b8",
  biscuit: "#dec4a4",
  almond: "#efdecd",
  latte: "#c5a582",
  cappuccino: "#9e7b5b",
  taupe: "#8b7d70",
  khaki: "#c3b091",
  tan: "#d2b48c",
  camel: "#c19a6b",
  caramel: "#af6e4d",
  toffee: "#8c5332",
  butterscotch: "#d99041",
  honey: "#d89b32",
  amber: "#d97706",
  cinnamon: "#9c4a27",
  cognac: "#8a4624",
  bronze: "#8c6239",
  copper: "#b86b43",
  terracotta: "#c66348",
  clay: "#b66a50",
  sienna: "#a0522d",
  rust: "#a34124",
  chestnut: "#7b3f2b",
  walnut: "#5c4028",
  hazel: "#8e7652",
  hazelnut: "#9c7a54",
  mocha: "#705344",
  coffee: "#593e2e",
  cocoa: "#6b4433",
  chocolate: "#4a2c1d",
  brown: "#5c3a21",
  umber: "#635147",
  mahogany: "#54211a",
  sepia: "#704214",
  espresso: "#3b271e",
  truffle: "#614e45",
  pecan: "#8d5b3e",
  ginger: "#b0652b",
  chai: "#b58b67",
  dune: "#ccb89d",
  macchiato: "#a78465",

  // Blacks, Charcoals & Greys
  black: "#18181b",
  jet: "#111113",
  "jet black": "#0d0d0f",
  onyx: "#222326",
  ebony: "#282c2a",
  obsidian: "#1c1e24",
  ink: "#1c222e",
  pitch: "#121214",
  raven: "#232528",
  soot: "#2e2d2b",
  charcoal: "#374151",
  graphite: "#464a52",
  gunmetal: "#4b535c",
  anthracite: "#383e42",
  slate: "#64748b",
  steel: "#718096",
  pewter: "#899499",
  iron: "#5a5e63",
  ash: "#9ca3af",
  smoke: "#84888c",
  fog: "#cbd5e1",
  mist: "#d5dce2",
  dove: "#b5b3ae",
  silver: "#c0c5ce",
  platinum: "#d8dce0",
  grey: "#6b7280",
  gray: "#6b7280",
  stone: "#8d867e",
  pebble: "#9a958d",
  cement: "#a3a29d",
  concrete: "#959794",
  zinc: "#71717a",
  titanium: "#878681",

  // Pinks, Roses, Corals & Peaches
  pink: "#ec4899",
  blush: "#e8aeb7",
  rose: "#d47285",
  "dusty pink": "#c98b94",
  "dusty rose": "#ba7a84",
  "old rose": "#b8737c",
  rosewood: "#65262b",
  "rose gold": "#c8968c",
  rosegold: "#c8968c",
  petal: "#f4ccd4",
  sakura: "#f7c8d0",
  "cherry blossom": "#f6c1cc",
  flamingo: "#ec7b94",
  salmon: "#ea8c7b",
  coral: "#eb6b56",
  peach: "#f4b393",
  apricot: "#eda276",
  nectarine: "#eb8258",
  watermelon: "#e3526a",
  strawberry: "#d94662",
  raspberry: "#b52b5c",
  magenta: "#c02678",
  fuchsia: "#c9288d",
  "hot pink": "#e11d74",
  bubblegum: "#f285b5",
  carnation: "#f497b6",
  cerise: "#c72c61",
  powder: "#eed5d2",
  ballet: "#f2d3d8",

  // Reds, Burgundies & Wines
  red: "#dc2626",
  crimson: "#b91c1c",
  scarlet: "#d92121",
  vermilion: "#d63c22",
  ruby: "#9b111e",
  garnet: "#731b22",
  carmine: "#960018",
  cherry: "#990f24",
  apple: "#b52126",
  brick: "#9b3928",
  chili: "#a82419",
  poppy: "#e3342f",
  cardinal: "#8c1d2b",
  burgundy: "#800020",
  wine: "#520014",
  maroon: "#630d16",
  merlot: "#581825",
  bordeaux: "#4f0f1e",
  claret: "#68192b",
  oxblood: "#4a0e17",
  mulberry: "#701f46",
  berry: "#8a2252",
  cranberry: "#911e38",
  pomegranate: "#8f1d2c",
  sangria: "#75172b",

  // Purples, Mauves & Lavenders
  mauve: "#a87c96",
  lilac: "#c4a3d4",
  lavender: "#b49fcc",
  wisteria: "#a58cc4",
  orchid: "#b565a7",
  periwinkle: "#8c96c9",
  thistle: "#cbbad4",
  heather: "#9a8aa4",
  iris: "#6855a3",
  amethyst: "#7c5295",
  violet: "#7c3aed",
  purple: "#6b21a8",
  grape: "#582a72",
  plum: "#602456",
  damson: "#4b1f44",
  eggplant: "#3d1e38",
  aubergine: "#371a33",
  indigo: "#3730a3",
  boysenberry: "#69214c",

  // Blues, Navies & Teals
  blue: "#2563eb",
  navy: "#1e293b",
  "navy blue": "#1b2a4a",
  midnight: "#151c2e",
  "midnight blue": "#17233b",
  "royal blue": "#1d4ed8",
  cobalt: "#1e40af",
  sapphire: "#133882",
  denim: "#3b5b82",
  chambray: "#6482a3",
  cornflower: "#5b82d6",
  "steel blue": "#4a7399",
  "powder blue": "#b0cde3",
  "baby blue": "#99c5e8",
  sky: "#60a5fa",
  "sky blue": "#68b2f8",
  "ice blue": "#c7e2f0",
  glacier: "#a5cadb",
  cerulean: "#1d78b5",
  azure: "#2482db",
  cyan: "#06b6d4",
  aqua: "#22d3ee",
  aquamarine: "#5eead4",
  turquoise: "#14b8a6",
  teal: "#0f766e",
  peacock: "#0b5e68",
  petrol: "#144b57",
  aegean: "#336178",
  ocean: "#1c587a",
  marine: "#193f66",
  arctic: "#9ac2d4",
  "duck egg": "#a6c9c5",
  "robin egg": "#6bc9c6",
  prussian: "#0b3152",

  // Greens, Sages & Olives
  green: "#16a34a",
  sage: "#8fa98f",
  "sage green": "#86a388",
  mint: "#98d8b6",
  pistachio: "#a5c98e",
  celadon: "#a8c9b1",
  seafoam: "#8ed1b9",
  eucalyptus: "#6e9183",
  "tea green": "#c6dfb8",
  matcha: "#87a363",
  jade: "#1f8a65",
  emerald: "#059669",
  malachite: "#0d7550",
  viridian: "#256b58",
  kelly: "#229944",
  shamrock: "#158f50",
  clover: "#2d8a4e",
  lime: "#84cc16",
  chartreuse: "#a3d929",
  pear: "#b5c93a",
  avocado: "#657d32",
  olive: "#556b2f",
  "olive green": "#556b2f",
  army: "#4b5320",
  "army green": "#4b5320",
  military: "#4e572b",
  moss: "#6b7d47",
  fern: "#4f7942",
  forest: "#1b4d2e",
  "forest green": "#1b4d2e",
  pine: "#174736",
  evergreen: "#133b2b",
  hunter: "#21472c",
  "bottle green": "#103d29",
  cypress: "#3a523f",
  juniper: "#3b5c53",
  seaweed: "#354a3c",
  basil: "#4f6e49",
  thyme: "#5a6e58",
  artichoke: "#738264",
  cactus: "#587256",
  loden: "#455232",

  // Yellows, Golds & Oranges
  yellow: "#eab308",
  lemon: "#facc15",
  butter: "#f7e38d",
  buttercream: "#f5e6ad",
  canary: "#fde047",
  daffodil: "#f9d749",
  dandelion: "#f0c420",
  sunflower: "#e5a916",
  marigold: "#e5941a",
  mustard: "#c4911a",
  ochre: "#b87a1c",
  saffron: "#e09819",
  turmeric: "#c77d1a",
  gold: "#d4af37",
  golden: "#d4a82a",
  goldenrod: "#c99a24",
  brass: "#a88b3a",
  orange: "#ea580c",
  tangerine: "#f2741d",
  mandarin: "#e05f19",
  clementine: "#e86a17",
  persimmon: "#d4552b",
  papaya: "#ed7d4a",
  mango: "#f09b2b",
  pumpkin: "#d6641e",
  "burnt orange": "#b54918",
};

type ColorModifier = "light" | "dark" | "dusty" | "warm" | "cool" | "bright";

const MODIFIER_TOKENS: Record<string, ColorModifier> = {
  light: "light",
  soft: "light",
  pale: "light",
  pastel: "light",
  baby: "light",
  icy: "light",
  ice: "light",
  creamy: "light",
  faint: "light",
  sheer: "light",
  washed: "light",
  bleached: "light",
  tinted: "light",
  frost: "light",
  misty: "light",
  milky: "light",

  dark: "dark",
  deep: "dark",
  night: "dark",
  shadow: "dark",
  rich: "dark",
  heavy: "dark",
  burnt: "dark",
  aged: "dark",
  royal: "dark",
  imperial: "dark",
  antique: "dark",
  vintage: "dark",
  dense: "dark",

  dusty: "dusty",
  muted: "dusty",
  smoky: "dusty",
  smoked: "dusty",
  ashy: "dusty",
  faded: "dusty",
  weathered: "dusty",
  earthy: "dusty",
  neutral: "dusty",
  dirty: "dusty",

  warm: "warm",
  sunny: "warm",

  cool: "cool",
  cold: "cool",
  frosty: "cool",

  bright: "bright",
  neon: "bright",
  vivid: "bright",
  electric: "bright",
  hot: "bright",
  vibrant: "bright",
  bold: "bright",
};

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
  );
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = (((h % 360) + 360) % 360) / 360;
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;

  if (sn === 0) {
    const val = ln * 255;
    return [val, val, val];
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };

  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  return [
    hue2rgb(p, q, hn + 1 / 3) * 255,
    hue2rgb(p, q, hn) * 255,
    hue2rgb(p, q, hn - 1 / 3) * 255,
  ];
}

function applyModifiersToHex(hex: string, modifiers: readonly ColorModifier[]): string {
  if (modifiers.length === 0) return hex;
  const [r, g, b] = hexToRgb(hex);
  let [h, s, l] = rgbToHsl(r, g, b);

  for (const mod of modifiers) {
    switch (mod) {
      case "light":
        l = l + (92 - l) * 0.35;
        s = s * 0.85;
        break;
      case "dark":
        l = l * 0.65;
        s = Math.min(100, s * 1.05);
        break;
      case "dusty":
        s = s * 0.55;
        l = l < 45 ? l + 10 : l > 75 ? l - 8 : l;
        break;
      case "bright":
        s = Math.min(100, s * 1.3 + 12);
        l = Math.max(42, Math.min(62, l));
        break;
      case "warm":
        h = (h + 350) % 360;
        s = Math.min(100, s * 1.08);
        break;
      case "cool":
        h = (h + 12) % 360;
        break;
    }
  }
  const [nr, ng, nb] = hslToRgb(h, s, l);
  return rgbToHex(nr, ng, nb);
}

function blendHexColors(hexes: readonly string[]): string {
  const rgbs = hexes.map(hexToRgb);
  const sum = rgbs.reduce(
    (acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b],
    [0, 0, 0]
  );
  return rgbToHex(
    sum[0] / rgbs.length,
    sum[1] / rgbs.length,
    sum[2] / rgbs.length
  );
}

function resolveSingleColorHex(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Direct hex code support (e.g. "#800020" or "Ruby (#9b111e)")
  const hexMatch = trimmed.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
  if (hexMatch) {
    const [r, g, b] = hexToRgb(hexMatch[0]);
    return rgbToHex(r, g, b);
  }

  // 2. Clean and normalize phrase into lowercase words
  const phrase = trimmed
    .toLowerCase()
    .replace(/[()[\]{}'",.]+/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!phrase) return null;

  // Exact match in fashion dictionary
  if (FASHION_COLOR_HEX[phrase]) {
    return FASHION_COLOR_HEX[phrase];
  }

  const words = phrase.split(" ");

  // Check multi-word bigrams from right to left (head noun in English is usually last)
  for (let i = words.length - 2; i >= 0; i--) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (FASHION_COLOR_HEX[bigram]) {
      const remaining = words.filter((_, idx) => idx !== i && idx !== i + 1);
      const mods = remaining
        .map((w) => MODIFIER_TOKENS[w])
        .filter((m): m is ColorModifier => Boolean(m));
      return applyModifiersToHex(FASHION_COLOR_HEX[bigram], mods);
    }
  }

  // Collect individual color tokens and modifier tokens
  const matchedHexes: string[] = [];
  const modifiers: ColorModifier[] = [];

  for (const word of words) {
    if (FASHION_COLOR_HEX[word]) {
      matchedHexes.push(FASHION_COLOR_HEX[word]);
    } else if (MODIFIER_TOKENS[word]) {
      modifiers.push(MODIFIER_TOKENS[word]);
    } else if (word.endsWith("ish") && word.length > 4) {
      // Handle forms like "pinkish", "bluish", "greenish", "reddish", "brownish"
      const stem = word.slice(0, -3);
      const deDoubled = stem.length > 3 && stem[stem.length - 1] === stem[stem.length - 2]
        ? stem.slice(0, -1)
        : stem;
      const candidate =
        FASHION_COLOR_HEX[stem] ??
        FASHION_COLOR_HEX[deDoubled] ??
        FASHION_COLOR_HEX[`${stem}e`];
      if (candidate) {
        matchedHexes.push(candidate);
        modifiers.push("dusty");
      }
    }
  }

  if (matchedHexes.length === 0) {
    return null;
  }

  // If multiple color words appear in one shade (e.g. "Blue Grey", "Rose Beige"),
  // weight the final word slightly higher (60/40) as the primary hue.
  let baseHex: string;
  if (matchedHexes.length === 1) {
    baseHex = matchedHexes[0];
  } else {
    const primary = matchedHexes[matchedHexes.length - 1];
    const secondary = blendHexColors(matchedHexes.slice(0, -1));
    baseHex = blendHexColors([secondary, primary, primary]);
  }

  return applyModifiersToHex(baseHex, modifiers);
}

function borderForHex(hex: string): string | undefined {
  const [r, g, b] = hexToRgb(hex);
  const [, , l] = rgbToHsl(r, g, b);
  if (l >= 82) return "rgba(255, 255, 255, 0.48)";
  if (l <= 16) return "rgba(216, 183, 140, 0.45)";
  return undefined;
}

/**
 * Resolves a human colorway name into a visual swatch style.
 *
 * - Supports 170+ fashion shades ("Dusty Pink", "Emerald", "Mocha", "Off-White", "Taupe").
 * - Understands modifiers ("Light Olive", "Dark Teal", "Soft Lilac", "Muted Sage").
 * - Blends compound hues ("Blue Grey", "Rose Beige").
 * - Renders split two-tone swatches for paired colors ("Black / White", "Navy & Gold").
 * - Returns `null` when a label contains no recognizable color so the UI can omit
 *   the dot instead of showing a misleading fallback color.
 */
export function getColorSwatch(name: string): ColorSwatchStyle | null {
  if (!name || typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed) return null;

  // Check for explicit two-tone separator: "/", "&", "+", or " and "
  const splitParts = trimmed
    .split(/\s*(?:\/|&|\+|\band\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);

  if (splitParts.length >= 2) {
    const first = resolveSingleColorHex(splitParts[0]);
    const second = resolveSingleColorHex(splitParts[1]);
    if (first && second) {
      return {
        bg: `linear-gradient(135deg, ${first} 0%, ${first} 50%, ${second} 50%, ${second} 100%)`,
        border: borderForHex(first) ?? borderForHex(second),
      };
    }
  }

  const singleHex = resolveSingleColorHex(trimmed);
  if (!singleHex) return null;

  const border = borderForHex(singleHex);
  return border ? { bg: singleHex, border } : { bg: singleHex };
}

