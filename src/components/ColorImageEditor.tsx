"use client";

import { useRef, useState } from "react";
import { compressImageClient } from "@/lib/client-image-compression";
import { parseApiResponse } from "@/lib/api-client";
import {
  MAX_IMAGES_PER_COLOR,
  normalizeColorKey,
  normalizeColorLabel,
  type ColorImageDraft,
} from "@/lib/product-color-images";

/**
 * One card per colour, holding that colour's gallery.
 *
 * The form owns the drafts; this component only edits them, so both admin pages
 * can turn them into a request body with `colorImagePayload` alone. Images are
 * uploaded as they are picked (`/api/upload`, `PRODUCT_IMAGE`) rather than on
 * save, so a rejected save never re-uploads the whole form.
 */
interface ColorImageEditorProps {
  /** Colour options on the form right now, in the order the admin typed them. */
  colors: readonly string[];
  drafts: readonly ColorImageDraft[];
  onChange: (next: ColorImageDraft[]) => void;
  /** The product's main image: what a colour without its own gallery shows. */
  fallbackImageUrl?: string;
  disabled?: boolean;
}

interface ColorCard {
  color: string;
  /** True when the colour is no longer in the form's colour list. */
  retired: boolean;
}

const thumbStyle: React.CSSProperties = {
  width: "72px",
  height: "72px",
  objectFit: "cover",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--color-neutral-300)",
  background: "var(--color-neutral-100)",
  display: "block",
};

const miniButtonStyle: React.CSSProperties = {
  border: "1px solid var(--color-neutral-300)",
  background: "var(--color-bg-white)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontSize: "var(--text-xs)",
  lineHeight: 1.2,
  padding: "2px 6px",
  color: "var(--color-neutral-700)",
};

async function uploadProductImage(file: File): Promise<string> {
  let payload = file;
  // The preview URL is only needed when the result is shown to the admin. Here
  // the upload goes out as a `File`, so the object URL would otherwise stay in
  // the page's blob store - one full-size image leaked per upload.
  let previewUrl: string | null = null;
  try {
    const compressed = await compressImageClient(file);
    payload = compressed.file;
    previewUrl = compressed.previewUrl;
  } catch (err) {
    // Compression is an optimisation, never a reason to lose the upload.
    console.error("Compression error:", err);
    payload = file;
  }
  try {
    const body = new FormData();
    body.append("file", payload);
    body.append("purpose", "PRODUCT_IMAGE");
    const res = await fetch("/api/upload", { method: "POST", body });
    const { ok, data, error } = await parseApiResponse<{ url?: string }>(
      res,
      "Failed to upload image."
    );
    if (!ok || !data?.url) throw new Error(error || "Failed to upload image.");
    return data.url;
  } finally {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }
}

export default function ColorImageEditor({
  colors,
  drafts,
  onChange,
  fallbackImageUrl,
  disabled = false,
}: ColorImageEditorProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const urlsFor = (color: string): readonly string[] => {
    const key = normalizeColorKey(color);
    return drafts.find((draft) => normalizeColorKey(draft.color) === key)?.urls ?? [];
  };

  const setUrls = (color: string, urls: readonly string[]) => {
    const key = normalizeColorKey(color);
    const rest = drafts.filter((draft) => normalizeColorKey(draft.color) !== key);
    onChange(
      urls.length > 0
        ? [...rest, { color: normalizeColorLabel(color), urls: [...urls] }]
        : rest
    );
  };

  const cards: ColorCard[] = [];
  for (const color of colors) {
    const label = normalizeColorLabel(color);
    const key = normalizeColorKey(label);
    if (key === "") continue;
    if (cards.some((card) => normalizeColorKey(card.color) === key)) continue;
    cards.push({ color: label, retired: false });
  }
  for (const draft of drafts) {
    const key = normalizeColorKey(draft.color);
    if (key === "" || draft.urls.length === 0) continue;
    if (cards.some((card) => normalizeColorKey(card.color) === key)) continue;
    // A colour dropped from the list keeps its photos on the product, so its card
    // stays until the admin clears it deliberately.
    cards.push({ color: normalizeColorLabel(draft.color), retired: true });
  }

  const handleFiles = async (color: string, fileList: FileList | null) => {
    const key = normalizeColorKey(color);
    const input = inputs.current[key];
    if (input) input.value = "";
    const files = fileList ? Array.from(fileList) : [];
    if (files.length === 0) return;

    const current = urlsFor(color);
    const room = MAX_IMAGES_PER_COLOR - current.length;
    if (room <= 0) {
      setError(
        `"${color}" already has ${MAX_IMAGES_PER_COLOR} images. Remove one before adding another.`
      );
      return;
    }

    setError("");
    setBusyKey(key);
    const uploaded: string[] = [];
    try {
      for (const file of files.slice(0, room)) {
        uploaded.push(await uploadProductImage(file));
      }
      if (files.length > room) {
        setError(
          `"${color}" holds ${MAX_IMAGES_PER_COLOR} images, so ${files.length - room} file(s) were skipped.`
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to upload image.");
    } finally {
      if (uploaded.length > 0) setUrls(color, [...current, ...uploaded]);
      setBusyKey(null);
    }
  };

  const move = (color: string, from: number, to: number) => {
    const urls = urlsFor(color);
    if (to < 0 || to >= urls.length || from === to) return;
    const next = [...urls];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setUrls(color, next);
  };

  const removeAt = (color: string, index: number) => {
    setUrls(
      color,
      urlsFor(color).filter((_, position) => position !== index)
    );
  };

  if (cards.length === 0) {
    return (
      <span className="form-hint">
        Add a colour above and its own gallery can be uploaded here. Until then
        every shopper sees the main product image.
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {cards.map((card) => {
        const urls = urlsFor(card.color);
        const key = normalizeColorKey(card.color);
        const busy = busyKey === key;
        const locked = disabled || busyKey !== null;
        return (
          <div
            key={key}
            style={{
              border: "1px solid var(--color-neutral-200)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-3)",
              background:
                urls.length > 0 ? "var(--color-neutral-50)" : "var(--color-bg-white)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "var(--space-3)",
                marginBottom: "var(--space-2)",
              }}
            >
              <div>
                <p
                  style={{
                    margin: 0,
                    fontSize: "var(--text-sm)",
                    fontWeight: 600,
                    color: "var(--color-neutral-800)",
                  }}
                >
                  {card.color}
                  {card.retired && (
                    <span
                      style={{
                        marginLeft: "var(--space-2)",
                        fontSize: "var(--text-xs)",
                        fontWeight: 500,
                        color: "var(--color-neutral-500)",
                      }}
                    >
                      (not in the colour list)
                    </span>
                  )}
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: "var(--text-xs)",
                    color: "var(--color-neutral-500)",
                  }}
                >
                  {busy
                    ? "Uploading..."
                    : urls.length === 0
                      ? "Showing the main product image."
                      : `${urls.length} of ${MAX_IMAGES_PER_COLOR} images. The first one is the cover.`}
                </p>
              </div>
              {urls.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{
                    padding: "var(--space-1) var(--space-3)",
                    fontSize: "var(--text-xs)",
                  }}
                  onClick={() => {
                    setError("");
                    setUrls(card.color, []);
                  }}
                  disabled={locked}
                >
                  Use main gallery
                </button>
              )}
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "var(--space-3)",
                marginBottom: "var(--space-2)",
              }}
            >
              {urls.length === 0 && fallbackImageUrl && (
                <img
                  src={fallbackImageUrl}
                  alt={`${card.color} fallback`}
                  style={thumbStyle}
                />
              )}
              {/* COLOR_IMAGE_THUMBS */}
              {urls.map((url, index) => (
                <div
                  key={`${key}-${index}`}
                  style={{ display: "flex", flexDirection: "column", gap: "2px" }}
                >
                  <img
                    src={url}
                    alt={`${card.color} image ${index + 1}`}
                    style={thumbStyle}
                  />
                  <div style={{ display: "flex", gap: "2px", justifyContent: "center" }}>
                    <button
                      type="button"
                      style={miniButtonStyle}
                      onClick={() => move(card.color, index, index - 1)}
                      disabled={locked || index === 0}
                      aria-label={`Move ${card.color} image ${index + 1} earlier`}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      style={miniButtonStyle}
                      onClick={() => move(card.color, index, index + 1)}
                      disabled={locked || index === urls.length - 1}
                      aria-label={`Move ${card.color} image ${index + 1} later`}
                    >
                      →
                    </button>
                    <button
                      type="button"
                      style={{ ...miniButtonStyle, color: "var(--color-error)" }}
                      onClick={() => removeAt(card.color, index)}
                      disabled={locked}
                      aria-label={`Remove ${card.color} image ${index + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                  {index === 0 && (
                    <span
                      style={{
                        textAlign: "center",
                        fontSize: "10px",
                        color: "var(--color-neutral-500)",
                      }}
                    >
                      Cover
                    </span>
                  )}
                </div>
              ))}
            </div>
            {/* COLOR_IMAGE_INPUT */}
            <input
              ref={(element) => {
                inputs.current[key] = element;
              }}
              type="file"
              accept="image/*"
              multiple
              className="form-input"
              style={{ padding: "var(--space-2)" }}
              disabled={locked}
              onChange={(event) => handleFiles(card.color, event.target.files)}
            />
          </div>
        );
      })}
      {error && (
        <span className="form-hint" style={{ color: "var(--color-error)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
