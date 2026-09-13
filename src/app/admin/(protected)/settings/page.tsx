"use client";

import { useState, useEffect } from "react";

interface PaymentMethod {
  id: string;
  name: string;
  instructions: string | null;
  accountName: string | null;
  accountNumber: string | null;
  requiresProof: boolean;
  active: boolean;
}

export default function AdminSettingsPage() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  useEffect(() => {
    fetch("/api/payment-methods")
      .then(r => r.json())
      .then(json => setMethods(json.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleUpdate = async (method: PaymentMethod) => {
    setSaving(method.id);
    try {
      const res = await fetch(`/api/admin/payment-methods/${method.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountName: method.accountName,
          accountNumber: method.accountNumber,
          instructions: method.instructions,
          active: method.active,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to update");
      showMsg("success", `${method.name} updated successfully.`);
    } catch (err: any) {
      showMsg("error", err.message);
    } finally {
      setSaving(null);
    }
  };

  const updateField = (id: string, field: keyof PaymentMethod, value: any) => {
    setMethods(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  return (
    <div>
      <h1 className="admin-page-title">Settings</h1>

      {message && (
        <div style={{
          padding: "var(--space-3) var(--space-4)",
          background: message.type === "success" ? "rgb(22 163 74 / 0.08)" : "rgb(220 38 38 / 0.08)",
          border: `1px solid ${message.type === "success" ? "rgb(22 163 74 / 0.3)" : "rgb(220 38 38 / 0.3)"}`,
          borderRadius: "var(--radius-lg)",
          color: message.type === "success" ? "var(--color-success)" : "var(--color-error)",
          fontWeight: 500,
          marginBottom: "var(--space-4)",
        }}>
          {message.type === "success" ? "✓ " : "⚠ "}{message.text}
        </div>
      )}

      {/* Payment Methods Section */}
      <div className="card" style={{ maxWidth: "700px", marginBottom: "var(--space-6)" }}>
        <div className="card-body">
          <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "var(--space-2)", color: "var(--color-brand-700)" }}>
            💳 Payment Methods
          </h2>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", marginBottom: "var(--space-5)" }}>
            Update your payment account details. These are displayed to customers during checkout.
          </p>

          {loading ? (
            <p style={{ color: "var(--color-neutral-400)", fontSize: "var(--text-sm)" }}>Loading...</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
              {methods.map(method => (
                <div key={method.id} style={{
                  padding: "var(--space-5)", border: "1px solid var(--color-neutral-200)",
                  borderRadius: "var(--radius-xl)", background: "var(--color-neutral-50)"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
                    <h3 style={{ fontWeight: 700, fontSize: "var(--text-base)" }}>{method.name}</h3>
                    <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer", fontSize: "var(--text-sm)", fontWeight: 500 }}>
                      <input
                        type="checkbox"
                        checked={method.active}
                        onChange={e => updateField(method.id, "active", e.target.checked)}
                        style={{ width: "16px", height: "16px", accentColor: "var(--color-brand-500)" }}
                      />
                      Active
                    </label>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                    <div className="form-group">
                      <label className="form-label">Account Name</label>
                      <input type="text" className="form-input" value={method.accountName || ""}
                        onChange={e => updateField(method.id, "accountName", e.target.value)}
                        placeholder="e.g. ANA Clothing" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Account Number</label>
                      <input type="text" className="form-input" value={method.accountNumber || ""}
                        onChange={e => updateField(method.id, "accountNumber", e.target.value)}
                        placeholder="e.g. 09123456789" />
                    </div>
                    <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                      <label className="form-label">Instructions for Customer</label>
                      <textarea className="form-input" value={method.instructions || ""}
                        onChange={e => updateField(method.id, "instructions", e.target.value)}
                        rows={2} style={{ resize: "vertical", minHeight: "60px" }}
                        placeholder="e.g. Send to 09XXXXXXXXX and upload your screenshot" />
                    </div>
                  </div>

                  <button
                    className="btn btn-primary btn-sm"
                    style={{ marginTop: "var(--space-3)" }}
                    onClick={() => handleUpdate(method)}
                    disabled={saving === method.id}
                  >
                    {saving === method.id ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* System Info */}
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
              <span style={{ fontWeight: 600 }}>1.0.0 (Alpha)</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingBlock: "var(--space-2)" }}>
              <span style={{ color: "var(--color-neutral-500)" }}>Database</span>
              <span style={{ fontWeight: 600 }}>PostgreSQL (Supabase)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
