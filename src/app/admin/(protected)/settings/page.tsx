"use client";

import { useState, useEffect, useCallback } from "react";
import { FORM_FIELD_TYPE_LABELS, type AdminFormField } from "@/lib/order-answers";
import { describeFieldState } from "@/lib/form-field-admin";
import type { FormFieldType } from "@prisma/client";

/**
 * Store configuration: the questions the checkout form asks.
 *
 * They are storefront-facing, owned by the operator, and safe to change
 * mid-drop because the storefront reads them on every page load rather than
 * at build time.
 *
 * Two panels that used to live here are gone.
 *
 * Payment methods: payment happens in Instagram DM, and the only thing the
 * app records is a Paid/Unpaid switch on each order.
 *
 * Store pricing: no delivery fee is charged at all, so there is nothing to
 * configure - shipping is arranged, and settled, in the same DM conversation.
 */

const FIELD_TYPES: FormFieldType[] = [
  "TEXT",
  "TEXTAREA",
  "PHONE",
  "EMAIL",
  "NUMBER",
  "SELECT",
];

/** A blank draft, so "Add field" and "Edit" share one form. */
const EMPTY_DRAFT = {
  key: "",
  label: "",
  type: "TEXT" as FormFieldType,
  placeholder: "",
  helpText: "",
  required: false,
  sensitive: false,
  options: "",
  active: true,
};

type Draft = typeof EMPTY_DRAFT;

/** Result of loading the form-field list, without touching React state. */
type FieldsResponse =
  | { denied: true }
  | { denied: false; fields: AdminFormField[] };

/**
 * Fetches the form fields.
 *
 * Pure on purpose: the initial load runs inside an effect, and a function that
 * calls setState synchronously from an effect body causes the cascading render
 * the react-hooks rule warns about. State is applied from the promise callback.
 */
async function requestFields(): Promise<FieldsResponse> {
  const res = await fetch("/api/admin/form-fields");
  if (res.status === 401 || res.status === 403) return { denied: true };

  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || "Failed to load the form fields");

  return { denied: false, fields: json.data ?? [] };
}


export default function AdminSettingsPage() {
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Set when the API refuses a write: the page stays readable, but only a
  // role holding `settings.write` may change the checkout form.
  const [settingsDenied, setSettingsDenied] = useState(false);

  // Pre-order form fields.
  const [fields, setFields] = useState<AdminFormField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(true);
  // True when the list could not be fetched at all. Kept separate from an
  // empty list on purpose: "we could not load your questions" and "you have no
  // questions" are very different things to read the night before a drop.
  const [fieldsError, setFieldsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const loadFields = useCallback(async () => {
    try {
      const result = await requestFields();
      if (result.denied) {
        setSettingsDenied(true);
        return;
      }
      setFields(result.fields);
    } catch {
      // Leave the list as it is: a denied role is explained by the banner, and a
      // blip can be retried by reloading.
    } finally {
      setFieldsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // State is applied from the callback rather than by calling loadFields()
    // here, which would set state synchronously inside the effect body.
    requestFields()
      .then((result) => {
        if (cancelled) return;
        if (result.denied) {
          setSettingsDenied(true);
        } else {
          setFields(result.fields);
        }
      })
      // A rejected promise here is a real failure (a 500, a dropped connection).
      // Swallowing it left the list empty, so the screen rendered "No extra
      // questions yet" and the operator had to guess whether their questions had
      // been deleted. The failure is shown instead.
      .catch(() => {
        if (!cancelled) setFieldsError(true);
      })
      .finally(() => {
        if (!cancelled) setFieldsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** The API takes an array of option strings; the textarea edits them by line. */
  const draftPayload = () => ({
    key: draft.key,
    label: draft.label,
    type: draft.type,
    placeholder: draft.placeholder || null,
    helpText: draft.helpText || null,
    required: draft.required,
    sensitive: draft.sensitive,
    options:
      draft.type === "SELECT"
        ? draft.options
            .split(/[\n\r,;\uFF0C]+/)
            .map((line) => line.trim())
            .filter(Boolean)
        : [],
    active: draft.active,
  });

  const beginAdd = () => {
    setEditingId(null);
    setAdding(true);
    setDraft(EMPTY_DRAFT);
  };

  const beginEdit = (field: AdminFormField) => {
    setAdding(false);
    setEditingId(field.id);
    setDraft({
      key: field.key,
      label: field.label,
      type: field.type,
      placeholder: field.placeholder ?? "",
      helpText: field.helpText ?? "",
      required: field.required,
      sensitive: field.sensitive,
      options: field.options.join("\n"),
      active: field.active,
    });
  };

  const cancelForm = () => {
    setAdding(false);
    setEditingId(null);
  };

  const submitField = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        editingId ? `/api/admin/form-fields/${editingId}` : "/api/admin/form-fields",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draftPayload()),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to save the field");

      await loadFields();
      cancelForm();
      showMsg("success", editingId ? "Field updated." : "Field added to the pre-order form.");
    } catch (err) {
      showMsg("error", err instanceof Error ? err.message : "Failed to save the field");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (field: AdminFormField) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/form-fields/${field.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: field.key,
          label: field.label,
          type: field.type,
          placeholder: field.placeholder,
          helpText: field.helpText,
          required: field.required,
          sensitive: field.sensitive,
          options: field.options,
          sortOrder: field.sortOrder,
          active: !field.active,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to update the field");
      await loadFields();
      showMsg("success", field.active ? "Field hidden from checkout." : "Field shown at checkout.");
    } catch (err) {
      showMsg("error", err instanceof Error ? err.message : "Failed to update the field");
    } finally {
      setBusy(false);
    }
  };

  const deleteField = async (field: AdminFormField) => {
    if (!window.confirm(`Stop asking "${field.label}"? Answers already collected are kept.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/form-fields/${field.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to delete the field");
      await loadFields();
      showMsg("success", "Field deleted. Answers already collected are unaffected.");
    } catch (err) {
      showMsg("error", err instanceof Error ? err.message : "Failed to delete the field");
    } finally {
      setBusy(false);
    }
  };

  /** Moves a field one position and saves the whole order in one request. */
  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;

    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];

    setBusy(true);
    // Optimistic: a reorder should feel instant, and the response replaces the
    // list anyway.
    setFields(next);
    try {
      const res = await fetch("/api/admin/form-fields/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: next.map((field) => field.id) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to reorder");
      setFields(json.data ?? next);
    } catch (err) {
      showMsg("error", err instanceof Error ? err.message : "Failed to reorder");
      await loadFields();
    } finally {
      setBusy(false);
    }
  };

  /** The shared add/edit form. `key` is immutable once a field exists. */
  const fieldForm = (
    <div className="card" style={{ background: "var(--color-neutral-50)", marginTop: "var(--space-4)" }}>
      <div className="card-body">
        <h3 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-4)" }}>
          {editingId ? "Edit question" : "New question"}
        </h3>

        <div className="form-group">
          <label className="form-label">Label (what the customer reads)</label>
          <input
            className="form-input"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="Mobile Number"
            maxLength={80}
          />
        </div>

        <div className="form-group" style={{ marginTop: "var(--space-3)" }}>
          <label className="form-label">Key (permanent)</label>
          <input
            className="form-input"
            value={draft.key}
            onChange={(e) => setDraft({ ...draft, key: e.target.value.toLowerCase() })}
            placeholder="mobile_number"
            disabled={Boolean(editingId)}
            maxLength={40}
          />
          <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)", marginTop: "var(--space-1)" }}>
            {editingId
              ? "Keys are permanent: every answer is filed under it. Rename the label instead."
              : "Lowercase letters, numbers and underscores. Cannot be changed later."}
          </p>
        </div>

        <div className="form-group" style={{ marginTop: "var(--space-3)" }}>
          <label className="form-label">Type</label>
          <select
            className="form-input"
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value as FormFieldType })}
          >
            {FIELD_TYPES.map((type) => (
              <option key={type} value={type}>{FORM_FIELD_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </div>

        {draft.type === "SELECT" && (
          <div className="form-group" style={{ marginTop: "var(--space-3)" }}>
            <label className="form-label">Choices (comma-separated or one per line)</label>
            <textarea
              className="form-input"
              rows={4}
              value={draft.options}
              onChange={(e) => setDraft({ ...draft, options: e.target.value })}
              placeholder={"Small, Medium, Large\n— or one per line"}
            />
          </div>
        )}

        <div className="form-group" style={{ marginTop: "var(--space-3)" }}>
          <label className="form-label">Placeholder (optional)</label>
          <input
            className="form-input"
            value={draft.placeholder}
            onChange={(e) => setDraft({ ...draft, placeholder: e.target.value })}
            maxLength={120}
          />
        </div>

        <div className="form-group" style={{ marginTop: "var(--space-3)" }}>
          <label className="form-label">Help text (optional)</label>
          <input
            className="form-input"
            value={draft.helpText}
            onChange={(e) => setDraft({ ...draft, helpText: e.target.value })}
            placeholder="Only used for the courier."
            maxLength={240}
          />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-4)", fontSize: "var(--text-sm)" }}>
          <input
            type="checkbox"
            checked={draft.required}
            onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
          />
          Required — the customer cannot submit without answering
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-2)", fontSize: "var(--text-sm)" }}>
          <input
            type="checkbox"
            checked={draft.sensitive}
            onChange={(e) => setDraft({ ...draft, sensitive: e.target.checked })}
          />
          Sensitive — hidden from staff without the <code>customers.read</code> permission
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-2)", fontSize: "var(--text-sm)" }}>
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          />
          Show on the checkout form
        </label>

        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-5)" }}>
          <button className="btn btn-primary btn-sm" onClick={submitField} disabled={busy || draft.label.trim() === "" || draft.key.trim() === ""}>
            {busy ? "Saving…" : editingId ? "Save changes" : "Add question"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={cancelForm} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <h1 className="admin-page-title">Settings</h1>

      {message && (
        <div
          role={message.type === "error" ? "alert" : undefined}
          style={{
            padding: "var(--space-3) var(--space-4)",
            background: message.type === "success" ? "rgb(22 163 74 / 0.08)" : "rgb(220 38 38 / 0.08)",
            border: `1px solid ${message.type === "success" ? "rgb(22 163 74 / 0.3)" : "rgb(220 38 38 / 0.3)"}`,
            borderRadius: "var(--radius-lg)",
            color: message.type === "success" ? "var(--color-success)" : "var(--color-error)",
            fontWeight: 500,
            marginBottom: "var(--space-4)",
          }}
        >
          {message.type === "success" ? "✓" : "⚠"} {message.text}
        </div>
      )}

      {/* Pre-order form */}
      <div className="card" style={{ maxWidth: "900px", marginBottom: "var(--space-6)" }}>
        <div className="card-body">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-4)" }}>
            <div>
              <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "var(--space-2)", color: "var(--color-brand-700)" }}>
                📝 Pre-Order Form
              </h2>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)" }}>
                What checkout asks, besides the customer&apos;s name and Instagram username.
                Answers are stored on the order together with the label that was shown, so
                renaming a question never rewrites history.
              </p>
            </div>
            {!adding && !editingId && !settingsDenied && (
              <button className="btn btn-primary btn-sm" onClick={beginAdd} disabled={busy}>
                + Add question
              </button>
            )}
          </div>

          {settingsDenied ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", marginTop: "var(--space-4)" }}>
              🔒 Your role does not permit changing the checkout form.
            </p>
          ) : fieldsLoading ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", marginTop: "var(--space-4)" }}>
              Loading…
            </p>
          ) : fieldsError ? (
            <p
              role="alert"
              style={{ fontSize: "var(--text-sm)", color: "var(--color-error)", marginTop: "var(--space-4)" }}
            >
              The checkout questions could not be loaded, so this list is not the
              real one. Reload the page to try again - nothing has been changed.
            </p>
          ) : fields.length === 0 ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", marginTop: "var(--space-4)" }}>
              No extra questions yet — checkout asks only for a name and an Instagram username.
            </p>
          ) : (
            <div className="table-wrapper" style={{ marginTop: "var(--space-4)" }}>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: "90px" }}>Order</th>
                      <th>Question</th>
                      <th>Type</th>
                      <th>State</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field, index) => {
                      const state = describeFieldState(field);
                      return (
                        <tr key={field.id}>
                          <td>
                            <div style={{ display: "flex", gap: "var(--space-1)" }}>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => move(index, -1)}
                                disabled={busy || index === 0 || Boolean(field.deletedAt)}
                                title="Move up"
                                aria-label={`Move ${field.label} up`}
                              >
                                ↑
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => move(index, 1)}
                                disabled={busy || index === fields.length - 1 || Boolean(field.deletedAt)}
                                title="Move down"
                                aria-label={`Move ${field.label} down`}
                              >
                                ↓
                              </button>
                            </div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{field.label}</div>
                            <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                              <code>{field.key}</code>
                              {field.required && " · required"}
                              {field.sensitive && " · sensitive"}
                            </div>
                          </td>
                          <td style={{ fontSize: "var(--text-sm)" }}>
                            {FORM_FIELD_TYPE_LABELS[field.type]}
                          </td>
                          <td>
                            <span className={`badge ${state === "Live" ? "badge-confirmed" : state === "Hidden" ? "badge-closed" : "badge-cancelled"}`}>
                              {state}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                              {!field.deletedAt && (
                                <>
                                  <button className="btn btn-ghost btn-sm" onClick={() => beginEdit(field)} disabled={busy}>
                                    Edit
                                  </button>
                                  <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(field)} disabled={busy}>
                                    {field.active ? "Hide" : "Show"}
                                  </button>
                                  <button className="btn btn-ghost btn-sm" onClick={() => deleteField(field)} disabled={busy} style={{ color: "var(--color-error)" }}>
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(adding || editingId) && fieldForm}
        </div>
      </div>

      {/* System info */}
      <div className="card" style={{ maxWidth: "700px" }}>
        <div className="card-body">
          <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "var(--space-4)", color: "var(--color-brand-700)" }}>
            ℹ️ System Information
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", fontSize: "var(--text-sm)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", paddingBlock: "var(--space-2)", borderBottom: "1px solid var(--color-neutral-100)" }}>
              <span style={{ color: "var(--color-neutral-500)" }}>System</span>
              <span style={{ fontWeight: 600 }}>ANA Pre-Order System</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingBlock: "var(--space-2)", borderBottom: "1px solid var(--color-neutral-100)" }}>
              <span style={{ color: "var(--color-neutral-500)" }}>Version</span>
              <span style={{ fontWeight: 600 }}>1.1.0 (Alpha)</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingBlock: "var(--space-2)", borderBottom: "1px solid var(--color-neutral-100)" }}>
              <span style={{ color: "var(--color-neutral-500)" }}>Payments</span>
              <span style={{ fontWeight: 600 }}>Recorded manually (settled in Instagram DM)</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingBlock: "var(--space-2)" }}>
              <span style={{ color: "var(--color-neutral-500)" }}>Database</span>
              <span style={{ fontWeight: 600 }}>PostgreSQL</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

