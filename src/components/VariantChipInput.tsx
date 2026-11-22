"use client";
import { useState, type KeyboardEvent } from "react";

interface VariantChipInputProps {
  label: string;
  hint?: string;
  placeholder?: string;
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export function VariantChipInput({
  label,
  hint,
  placeholder,
  values,
  onChange,
  disabled = false,
}: VariantChipInputProps) {
  const [draft, setDraft] = useState("");

  const addTokens = (raw: string) => {
    const parts = raw
      .split(/[\n\r,;\uFF0C]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const seen = new Set(values.map((v) => v.toLowerCase()));
    const next = [...values];
    for (const part of parts) {
      if (!seen.has(part.toLowerCase())) {
        seen.add(part.toLowerCase());
        next.push(part);
      }
    }
    if (next.length !== values.length) {
      onChange(next);
    }
    setDraft("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTokens(draft);
    } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  const removeAt = (idx: number) => {
    onChange(values.filter((_, i) => i !== idx));
  };

  return (
    <div className="form-group" style={{ flex: 1 }}>
      <label className="form-label">{label}</label>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
          padding: "8px 10px",
          border: "2px solid var(--color-neutral-300)",
          borderRadius: "var(--radius-lg)",
          background: "var(--color-bg-white)",
          minHeight: "48px",
          alignItems: "center",
        }}
      >
        {values.map((val, idx) => (
          <span
            key={val}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "3px 10px",
              borderRadius: "var(--radius-full)",
              background: "var(--color-neutral-100)",
              border: "1px solid var(--color-neutral-300)",
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              color: "var(--color-neutral-800)",
            }}
          >
            <span>{val}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => removeAt(idx)}
                aria-label={`Remove ${val}`}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-neutral-500)",
                  cursor: "pointer",
                  fontSize: "13px",
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <input
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (draft.trim()) addTokens(draft);
          }}
          placeholder={values.length === 0 ? placeholder : "Add & press Enter…"}
          style={{
            border: "none",
            outline: "none",
            flex: "1 1 110px",
            minWidth: "90px",
            fontSize: "var(--text-sm)",
            color: "var(--color-neutral-900)",
            background: "transparent",
          }}
        />
      </div>
      {hint && <span className="form-hint">{hint}</span>}
    </div>
  );
}
