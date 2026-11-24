"use client";

import { useEffect, useRef, useState } from "react";
import { compressImageClient, heifUploadHint } from "@/lib/client-image-compression";
import { parseApiResponse } from "@/lib/api-client";
import { imageUrlAtWidth } from "@/lib/image-geometry";
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
  /** Notifies the parent form when any colour photo upload starts or finishes. */
  onUploadingChange?: (uploading: boolean) => void;
}

interface ColorCard {
  color: string;
  /** True when the colour is no longer in the form's colour list. */
  retired: boolean;
}

type CardStatus =
  | { phase: "uploading"; done: number; total: number }
  | { phase: "done"; added: number }
  | { phase: "error"; message: string };

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

const UPLOAD_CONCURRENCY = 3;

async function uploadProductImage(file: File): Promise<string> {
  let payload = file;
  let previewUrl: string | null = null;
  const heifHint = heifUploadHint(file);
  try {
    const compressed = await compressImageClient(file);
    payload = compressed.file;
    previewUrl = compressed.previewUrl;
  } catch (err) {
    console.error("Compression error:", err);
    if (heifHint) throw new Error(heifHint);
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
  onUploadingChange,
}: ColorImageEditorProps) {
  const [statuses, setStatuses] = useState<Record<string, CardStatus>>({});
  const [error, setError] = useState("");
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  const anyUploading = Object.values(statuses).some(
    (status) => status.phase === "uploading"
  );

  useEffect(() => {
    onUploadingChange?.(anyUploading);
  }, [anyUploading, onUploadingChange]);

  const setStatus = (key: string, status: CardStatus | null) => {
    setStatuses((previous) => {
      const next = { ...previous };
      if (status) next[key] = status;
      else delete next[key];
      return next;
    });
  };

  const clearStatus = (color: string) => setStatus(normalizeColorKey(color), null);

  const urlsFor = (color: string, source: readonly ColorImageDraft[] = drafts): readonly string[] => {
    const key = normalizeColorKey(color);
    return source.find((draft) => normalizeColorKey(draft.color) === key)?.urls ?? [];
  };

  const setUrls = (color: string, urls: readonly string[]) => {
    const key = normalizeColorKey(color);
    const currentDrafts = draftsRef.current;
    const rest = currentDrafts.filter((draft) => normalizeColorKey(draft.color) !== key);
    const next =
      urls.length > 0
        ? [...rest, { color: normalizeColorLabel(color), urls: [...urls] }]
        : rest;
    draftsRef.current = next;
    onChange(next);
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
    cards.push({ color: normalizeColorLabel(draft.color), retired: true });
  }

  const handleFiles = async (color: string, fileList: FileList | null) => {
    const key = normalizeColorKey(color);
    const files = fileList ? Array.from(fileList) : [];
    const input = inputs.current[key];
    if (input) input.value = "";
    if (files.length === 0) return;

    const current = urlsFor(color, draftsRef.current);
    const room = MAX_IMAGES_PER_COLOR - current.length;
    if (room <= 0) {
      setError(
        `"${color}" already has ${MAX_IMAGES_PER_COLOR} images. Remove one before adding another.`
      );
      return;
    }

    setError("");
    const queue = files.slice(0, room);
    const results: (string | null)[] = new Array(queue.length).fill(null);
    let completed = 0;
    let failure = "";

    setStatus(key, { phase: "uploading", done: 0, total: queue.length });

    let nextIndex = 0;
    const runWorker = async () => {
      while (nextIndex < queue.length && !failure) {
        const idx = nextIndex++;
        try {
          const url = await uploadProductImage(queue[idx]);
          results[idx] = url;
          completed += 1;
          if (!failure) {
            setStatus(key, { phase: "uploading", done: completed, total: queue.length });
          }
        } catch (err: unknown) {
          if (!failure) {
            failure = err instanceof Error ? err.message : "Failed to upload image.";
          }
        }
      }
    };

    const workerCount = Math.min(UPLOAD_CONCURRENCY, queue.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    const uploaded = results.filter((u): u is string => typeof u === "string" && u.length > 0);
    if (uploaded.length > 0) {
      const latest = urlsFor(color, draftsRef.current);
      setUrls(color, [...latest, ...uploaded].slice(0, MAX_IMAGES_PER_COLOR));
    }
    setStatus(
      key,
      failure
        ? { phase: "error", message: failure }
        : { phase: "done", added: uploaded.length }
    );
    if (!failure && files.length > room) {
      setError(
        `"${color}" holds ${MAX_IMAGES_PER_COLOR} images, so ${files.length - room} file(s) were skipped.`
      );
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
    clearStatus(color);
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
        const status = statuses[key];
        const cardUploading = status?.phase === "uploading";
        const locked = disabled || cardUploading;
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
                  {status?.phase === "uploading"
                    ? status.total > 1
                      ? `Optimizing & uploading (${status.done}/${status.total})…`
                      : "Optimizing & uploading…"
                    : urls.length === 0
                      ? "Showing the main product image."
                      : `${urls.length} of ${MAX_IMAGES_PER_COLOR} images. The first one is the cover.`}
                </p>
                {status?.phase === "done" && (
                  <p
                    style={{
                      margin: 0,
                      marginTop: "var(--space-1)",
                      fontSize: "var(--text-xs)",
                      fontWeight: 600,
                      color: "var(--color-success)",
                    }}
                  >
                    {status.added} image{status.added === 1 ? "" : "s"} uploaded ✓
                  </p>
                )}
                {status?.phase === "error" && (
                  <p
                    style={{
                      margin: 0,
                      marginTop: "var(--space-1)",
                      fontSize: "var(--text-xs)",
                      fontWeight: 600,
                      color: "var(--color-error)",
                    }}
                  >
                    {status.message}
                  </p>
                )}
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
                    clearStatus(card.color);
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
                  src={imageUrlAtWidth(fallbackImageUrl, 400)}
                  alt={`${card.color} fallback`}
                  loading="lazy"
                  decoding="async"
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
                    src={imageUrlAtWidth(url, 400)}
                    alt={`${card.color} image ${index + 1}`}
                    loading="lazy"
                    decoding="async"
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
              disabled={locked}
              onChange={(event) => handleFiles(card.color, event.currentTarget.files)}
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
