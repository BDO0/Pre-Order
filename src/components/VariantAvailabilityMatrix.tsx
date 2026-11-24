"use client";

import { useState, useMemo } from "react";
import {
  describeVariant,
  variantKey,
  type VariantFormRow,
} from "@/lib/variant-plan";
import { getColorSwatch } from "@/lib/product-color-images";

export type AnnotatedVariantRow = VariantFormRow & {
  enabled: boolean;
  hint?: string;
};

interface VariantAvailabilityMatrixProps {
  sizes: readonly string[];
  colors: readonly string[];
  rows: readonly AnnotatedVariantRow[];
  fillValue: string;
  onFillValueChange: (val: string) => void;
  onFillEveryBox: () => void;
  onToggleRow: (row: VariantFormRow) => void;
  onSetRowsEnabled: (keys: string[], enabled: boolean) => void;
  onSetStock: (row: VariantFormRow, value: string) => void;
  onSetBulkStock?: (keys: string[], value: string) => void;
}

export function VariantAvailabilityMatrix({
  sizes,
  colors,
  rows,
  fillValue,
  onFillValueChange,
  onFillEveryBox,
  onToggleRow,
  onSetRowsEnabled,
  onSetStock,
  onSetBulkStock,
}: VariantAvailabilityMatrixProps) {
  const [selectedColorFilter, setSelectedColorFilter] = useState<string>("ALL");
  const [colorFillValues, setColorFillValues] = useState<Record<string, string>>({});

  const hasMatrix = sizes.length > 0 && colors.length > 0;
  const enabledCount = useMemo(() => rows.filter((r) => r.enabled).length, [rows]);

  const rowByKey = useMemo(() => {
    const map = new Map<string, AnnotatedVariantRow>();
    for (const r of rows) {
      map.set(variantKey(r.size, r.color), r);
    }
    return map;
  }, [rows]);

  const activeColorFilter =
    selectedColorFilter !== "ALL" && !colors.includes(selectedColorFilter)
      ? "ALL"
      : selectedColorFilter;

  const visibleColors = useMemo(() => {
    if (activeColorFilter === "ALL") return colors;
    return colors.filter((c) => c === activeColorFilter);
  }, [colors, activeColorFilter]);

  const toggleAllForColor = (color: string, enable: boolean) => {
    const keys = sizes.map((size) => variantKey(size, color));
    onSetRowsEnabled(keys, enable);
  };

  const toggleAllForSize = (size: string) => {
    const keys = colors.map((color) => variantKey(size, color));
    const allEnabled = keys.every((k) => rowByKey.get(k)?.enabled);
    onSetRowsEnabled(keys, !allEnabled);
  };

  const applyColorStock = (color: string) => {
    if (!onSetBulkStock) return;
    const raw = (colorFillValues[color] ?? "").trim();
    const enabledKeysForColor = sizes
      .map((size) => variantKey(size, color))
      .filter((k) => rowByKey.get(k)?.enabled);
    if (enabledKeysForColor.length === 0) return;
    onSetBulkStock(enabledKeysForColor, raw);
  };

  return (
    <div className="form-group">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: "var(--space-2)",
        }}
      >
        <label className="form-label" style={{ marginBottom: 0 }}>
          Size &amp; Colour Availability + Stock Limits
        </label>
        {rows.length > 1 && (
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            {enabledCount < rows.length && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ minHeight: "28px", padding: "2px 8px", fontSize: "11px" }}
                onClick={() =>
                  onSetRowsEnabled(
                    rows.map((r) => variantKey(r.size, r.color)),
                    true
                  )
                }
              >
                Enable all ({rows.length})
              </button>
            )}
          </div>
        )}
      </div>

      <span
        className="form-hint"
        style={{ display: "block", marginBottom: "var(--space-2)" }}
      >
        {sizes.length === 0 && colors.length === 0
          ? "Standard / One-Size product. Leave box empty for no limit."
          : `${enabledCount} of ${rows.length} option${
              rows.length === 1 ? "" : "s"
            } available. Tap any size pill or uncheck an option if a size isn't available for a colour. Leave stock empty for no limit.`}
      </span>

      {/* Global stock fill bar */}
      <div
        style={{
          display: "flex",
          gap: "var(--space-2)",
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: "var(--space-3)",
        }}
      >
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          className="form-input"
          style={{ maxWidth: "120px", minHeight: "40px", padding: "6px 10px" }}
          value={fillValue}
          onChange={(e) => onFillValueChange(e.target.value)}
          placeholder="e.g. 10"
          aria-label="Stock to give every option"
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onFillEveryBox}
        >
          Give every option this many
        </button>
      </div>

      {/* Quick Size × Colour Availability Matrix when both dimensions exist */}
      {hasMatrix && (
        <div
          style={{
            border: "1px solid var(--color-neutral-200)",
            borderRadius: "var(--radius-lg)",
            background: "var(--color-neutral-50)",
            padding: "var(--space-3)",
            marginBottom: "var(--space-3)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "var(--space-2)",
              marginBottom: "var(--space-2)",
            }}
          >
            <span
              style={{
                fontSize: "var(--text-xs)",
                fontWeight: 700,
                color: "var(--color-neutral-800)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Quick Availability Matrix (Tap sizes per colour)
            </span>
            <span
              style={{
                fontSize: "11px",
                color: "var(--color-neutral-500)",
              }}
            >
              Tap a size header to toggle that size for all colours
            </span>
          </div>

          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "var(--text-xs)",
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "6px 8px",
                      color: "var(--color-neutral-600)",
                      fontWeight: 600,
                      borderBottom: "1px solid var(--color-neutral-200)",
                    }}
                  >
                    Colour
                  </th>
                  {sizes.map((size) => {
                    const allSizeEnabled = colors.every(
                      (c) => rowByKey.get(variantKey(size, c))?.enabled
                    );
                    return (
                      <th
                        key={size}
                        style={{
                          textAlign: "center",
                          padding: "4px 4px",
                          borderBottom: "1px solid var(--color-neutral-200)",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleAllForSize(size)}
                          title={`Toggle size ${size} for all colours`}
                          style={{
                            padding: "4px 8px",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid var(--color-neutral-300)",
                            background: allSizeEnabled
                              ? "var(--color-bg-white)"
                              : "var(--color-neutral-100)",
                            color: "var(--color-neutral-800)",
                            fontWeight: 700,
                            fontSize: "11px",
                            cursor: "pointer",
                            minWidth: "36px",
                          }}
                        >
                          {size}
                        </button>
                      </th>
                    );
                  })}
                  <th
                    style={{
                      textAlign: "right",
                      padding: "6px 8px",
                      borderBottom: "1px solid var(--color-neutral-200)",
                      color: "var(--color-neutral-500)",
                      fontWeight: 600,
                    }}
                  >
                    Quick
                  </th>
                </tr>
              </thead>
              <tbody>
                {colors.map((color) => {
                  const swatch = getColorSwatch(color);
                  const enabledForColor = sizes.filter(
                    (s) => rowByKey.get(variantKey(s, color))?.enabled
                  ).length;
                  const allColorEnabled = enabledForColor === sizes.length;
                  return (
                    <tr
                      key={color}
                      style={{
                        borderBottom: "1px solid var(--color-neutral-200)",
                      }}
                    >
                      <td
                        style={{
                          padding: "8px",
                          fontWeight: 600,
                          color: "var(--color-neutral-900)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          {swatch && (
                            <span
                              style={{
                                width: "12px",
                                height: "12px",
                                borderRadius: "50%",
                                background: swatch.bg,
                                border: swatch.border
                                  ? `1px solid ${swatch.border}`
                                  : "1px solid rgba(0,0,0,0.2)",
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <span>{color}</span>
                          <span
                            style={{
                              fontSize: "10px",
                              color:
                                enabledForColor === 0
                                  ? "var(--color-error)"
                                  : "var(--color-neutral-500)",
                              fontWeight: 500,
                            }}
                          >
                            ({enabledForColor}/{sizes.length})
                          </span>
                        </div>
                      </td>
                      {sizes.map((size) => {
                        const row = rowByKey.get(variantKey(size, color));
                        if (!row) return <td key={size} />;
                        return (
                          <td
                            key={size}
                            style={{
                              textAlign: "center",
                              padding: "4px",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => onToggleRow(row)}
                              aria-pressed={row.enabled}
                              aria-label={`${
                                row.enabled ? "Disable" : "Enable"
                              } ${color} / ${size}`}
                              style={{
                                minWidth: "42px",
                                minHeight: "34px",
                                padding: "4px 8px",
                                borderRadius: "var(--radius-md)",
                                border: row.enabled
                                  ? "1.5px solid var(--color-brand-600)"
                                  : "1px dashed var(--color-neutral-300)",
                                background: row.enabled
                                  ? "var(--color-brand-50)"
                                  : "var(--color-bg-white)",
                                color: row.enabled
                                  ? "var(--color-brand-700)"
                                  : "var(--color-neutral-400)",
                                fontWeight: row.enabled ? 700 : 500,
                                fontSize: "11px",
                                textDecoration: row.enabled
                                  ? "none"
                                  : "line-through",
                                cursor: "pointer",
                              }}
                            >
                              {row.enabled ? `✓ ${size}` : size}
                            </button>
                          </td>
                        );
                      })}
                      <td
                        style={{
                          textAlign: "right",
                          padding: "4px 8px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            toggleAllForColor(color, !allColorEnabled)
                          }
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            color: "var(--color-brand-600)",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: "4px 6px",
                          }}
                        >
                          {allColorEnabled ? "None" : "All"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filter pills when a product has multiple colours so iPad users don't have to scroll a huge list */}
      {hasMatrix && colors.length > 2 && (
        <div
          style={{
            display: "flex",
            gap: "6px",
            flexWrap: "wrap",
            alignItems: "center",
            marginBottom: "var(--space-3)",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--color-neutral-500)",
              marginRight: "2px",
            }}
          >
            Show stock for:
          </span>
          <button
            type="button"
            onClick={() => setSelectedColorFilter("ALL")}
            style={{
              padding: "4px 10px",
              borderRadius: "var(--radius-full)",
              border:
                activeColorFilter === "ALL"
                  ? "1.5px solid var(--color-brand-600)"
                  : "1px solid var(--color-neutral-300)",
              background:
                activeColorFilter === "ALL"
                  ? "var(--color-brand-50)"
                  : "var(--color-bg-white)",
              color:
                activeColorFilter === "ALL"
                  ? "var(--color-brand-700)"
                  : "var(--color-neutral-700)",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            All Colours ({colors.length})
          </button>
          {colors.map((color) => {
            const isSelected = activeColorFilter === color;
            const enabledInColor = sizes.filter(
              (s) => rowByKey.get(variantKey(s, color))?.enabled
            ).length;
            return (
              <button
                key={color}
                type="button"
                onClick={() => setSelectedColorFilter(color)}
                style={{
                  padding: "4px 10px",
                  borderRadius: "var(--radius-full)",
                  border: isSelected
                    ? "1.5px solid var(--color-brand-600)"
                    : "1px solid var(--color-neutral-300)",
                  background: isSelected
                    ? "var(--color-brand-50)"
                    : "var(--color-bg-white)",
                  color: isSelected
                    ? "var(--color-brand-700)"
                    : "var(--color-neutral-700)",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {color} ({enabledInColor}/{sizes.length})
              </button>
            );
          })}
        </div>
      )}

      {/* Per-option Stock List (grouped by colour when both dimensions exist) */}
      {hasMatrix ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          {visibleColors.map((color) => {
            const swatch = getColorSwatch(color);
            const colorRows = sizes
              .map((s) => rowByKey.get(variantKey(s, color)))
              .filter((r): r is AnnotatedVariantRow => Boolean(r));
            const enabledInColor = colorRows.filter((r) => r.enabled).length;

            return (
              <div
                key={color}
                style={{
                  border: "1px solid var(--color-neutral-200)",
                  borderRadius: "var(--radius-lg)",
                  padding: "var(--space-3)",
                  background: "var(--color-bg-white)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "var(--space-2)",
                    marginBottom: "var(--space-2)",
                    paddingBottom: "var(--space-2)",
                    borderBottom: "1px solid var(--color-neutral-100)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    {swatch && (
                      <span
                        style={{
                          width: "14px",
                          height: "14px",
                          borderRadius: "50%",
                          background: swatch.bg,
                          border: swatch.border
                            ? `1px solid ${swatch.border}`
                            : "1px solid rgba(0,0,0,0.2)",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: "var(--text-sm)",
                        color: "var(--color-neutral-900)",
                      }}
                    >
                      {color}
                    </span>
                    <span
                      style={{
                        fontSize: "var(--text-xs)",
                        color:
                          enabledInColor === 0
                            ? "var(--color-error)"
                            : "var(--color-neutral-500)",
                      }}
                    >
                      {enabledInColor} of {colorRows.length} size
                      {colorRows.length === 1 ? "" : "s"} enabled
                    </span>
                  </div>

                  {onSetBulkStock && enabledInColor > 1 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className="form-input"
                        style={{
                          width: "84px",
                          minHeight: "30px",
                          padding: "3px 8px",
                          fontSize: "var(--text-xs)",
                        }}
                        value={colorFillValues[color] ?? ""}
                        onChange={(e) =>
                          setColorFillValues((prev) => ({
                            ...prev,
                            [color]: e.target.value,
                          }))
                        }
                        placeholder="Stock…"
                        aria-label={`Stock for all ${color} sizes`}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{
                          minHeight: "30px",
                          padding: "3px 8px",
                          fontSize: "11px",
                        }}
                        onClick={() => applyColorStock(color)}
                      >
                        Set {color}
                      </button>
                    </div>
                  )}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      colorRows.length > 1
                        ? "repeat(auto-fill, minmax(240px, 1fr))"
                        : "1fr",
                    gap: "var(--space-2) var(--space-4)",
                  }}
                >
                  {colorRows.map((row) => (
                    <div
                      key={variantKey(row.size, row.color)}
                      style={{ opacity: row.enabled ? 1 : 0.55 }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-2)",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--space-2)",
                            flex: 1,
                            cursor: "pointer",
                            minHeight: "38px",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={() => onToggleRow(row)}
                            style={{
                              width: "18px",
                              height: "18px",
                              accentColor: "var(--color-brand-500)",
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: "var(--text-sm)",
                              fontWeight: 500,
                              color: "var(--color-neutral-900)",
                              textDecoration: row.enabled
                                ? "none"
                                : "line-through",
                            }}
                          >
                            {describeVariant(row)}
                          </span>
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          disabled={!row.enabled}
                          className="form-input"
                          style={{
                            maxWidth: "110px",
                            minHeight: "38px",
                            padding: "6px 10px",
                            fontSize: "var(--text-sm)",
                          }}
                          value={row.enabled ? row.capacity : ""}
                          onChange={(e) => onSetStock(row, e.target.value)}
                          placeholder={row.enabled ? "no limit" : "unavailable"}
                          aria-label={`How many ${describeVariant(
                            row
                          )} you can take`}
                        />
                      </div>
                      {row.hint && (
                        <span
                          className="form-hint"
                          style={{
                            display: "block",
                            marginTop: "2px",
                            paddingLeft: "26px",
                          }}
                        >
                          {row.hint}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}
        >
          {rows.map((row) => (
            <div
              key={variantKey(row.size, row.color)}
              style={{ opacity: row.enabled ? 1 : 0.55 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    flex: 1,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={() => onToggleRow(row)}
                    style={{
                      width: "18px",
                      height: "18px",
                      accentColor: "var(--color-brand-500)",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: "var(--text-sm)",
                      fontWeight: 500,
                      color: "var(--color-neutral-900)",
                      textDecoration: row.enabled ? "none" : "line-through",
                    }}
                  >
                    {describeVariant(row)}
                  </span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  disabled={!row.enabled}
                  className="form-input"
                  style={{ maxWidth: "130px" }}
                  value={row.enabled ? row.capacity : ""}
                  onChange={(e) => onSetStock(row, e.target.value)}
                  placeholder={row.enabled ? "no limit" : "unavailable"}
                  aria-label={`How many ${describeVariant(row)} you can take`}
                />
              </div>
              {row.hint && (
                <span
                  className="form-hint"
                  style={{
                    display: "block",
                    marginTop: "2px",
                    paddingLeft: "26px",
                  }}
                >
                  {row.hint}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
