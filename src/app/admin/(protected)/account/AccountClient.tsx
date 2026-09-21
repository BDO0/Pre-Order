"use client";

import { useState } from "react";
import { isKnownRole, ROLE_LABELS } from "@/lib/permissions";

/**
 * Change the password for the signed-in account.
 *
 * The account is identified by the session on the server — this form never
 * sends one — so it can only ever change the password of whoever is looking at
 * it. Every rule the server enforces is stated up front here too, because a
 * rule that only appears after a rejected attempt wastes a minute of someone's
 * night.
 */

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 72;

export default function AccountClient({
  email,
  name,
  role,
}: {
  email: string | null;
  name: string | null;
  role: string | null;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    // Caught here rather than server-side: it is a typo, not an attack, and
    // there is no reason to spend a request on it.
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "The two new passwords do not match." });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error?.message || "Could not change the password.");
      }

      setMessage({
        type: "success",
        text: "Password changed. Use the new one the next time you sign in.",
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setMessage({
        type: "error",
        text:
          err instanceof Error ? err.message : "Something went wrong. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {message && (
        <div
          role={message.type === "error" ? "alert" : undefined}
          style={{
            padding: "var(--space-3) var(--space-4)",
            background:
              message.type === "success" ? "rgb(22 163 74 / 0.08)" : "rgb(220 38 38 / 0.08)",
            border: `1px solid ${
              message.type === "success" ? "rgb(22 163 74 / 0.3)" : "rgb(220 38 38 / 0.3)"
            }`,
            borderRadius: "var(--radius-lg)",
            color: message.type === "success" ? "var(--color-success)" : "var(--color-error)",
            fontWeight: 500,
            marginBottom: "var(--space-4)",
          }}
        >
          {message.type === "success" ? "✓" : "⚠"} {message.text}
        </div>
      )}

      <div className="card" style={{ maxWidth: "700px", marginBottom: "var(--space-6)" }}>
        <div className="card-body">
          <h2
            style={{
              fontSize: "var(--text-lg)",
              fontWeight: 700,
              marginBottom: "var(--space-2)",
              color: "var(--color-brand-700)",
            }}
          >
            👤 Change Password
          </h2>
          <p
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--color-neutral-500)",
              marginBottom: "var(--space-5)",
            }}
          >
            The setup script creates the first admin with a password written in plain text in
            the repository. Changing it here is the step that makes this shop yours; nothing
            else in the app depends on the old one.
          </p>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--space-4)",
              fontSize: "var(--text-sm)",
              padding: "var(--space-3) var(--space-4)",
              background: "var(--color-neutral-50)",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--color-neutral-200)",
              marginBottom: "var(--space-5)",
            }}
          >
            <span>
              <strong>Signed in as</strong> {name ?? "Admin"}
            </span>
            {email && (
              <span>
                <strong>Email</strong> {email}
              </span>
            )}
            <span>
              <strong>Role</strong> {isKnownRole(role) ? ROLE_LABELS[role] : "Unknown"}
            </span>
          </div>

          <form
            onSubmit={submit}
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
          >
            <div className="form-group" style={{ maxWidth: "360px" }}>
              <label className="form-label" htmlFor="current-password">
                Current Password
              </label>
              <input
                id="current-password"
                type="password"
                className="form-input"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </div>

            <div className="form-group" style={{ maxWidth: "360px" }}>
              <label className="form-label" htmlFor="new-password">
                New Password
              </label>
              <input
                id="new-password"
                type="password"
                className="form-input"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-neutral-500)",
                  marginTop: "var(--space-1)",
                }}
              >
                At least {MIN_PASSWORD_LENGTH} characters, and not the password the setup
                script ships with. A phrase you will remember beats a jumble you will end up
                writing on a note.
              </p>
            </div>

            <div className="form-group" style={{ maxWidth: "360px" }}>
              <label className="form-label" htmlFor="confirm-password">
                Confirm New Password
              </label>
              <input
                id="confirm-password"
                type="password"
                className="form-input"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </div>

            <div>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Changing…" : "Change Password"}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="card" style={{ maxWidth: "700px" }}>
        <div className="card-body">
          <h2
            style={{
              fontSize: "var(--text-lg)",
              fontWeight: 700,
              marginBottom: "var(--space-3)",
              color: "var(--color-brand-700)",
            }}
          >
            ℹ️ What changing it does, and does not do
          </h2>
          <ul
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--color-neutral-600)",
              lineHeight: 1.7,
              paddingLeft: "var(--space-5)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            <li>
              The new password takes effect at the next sign-in. You stay signed in on this
              device, so changing it cannot interrupt a drop in progress.
            </li>
            <li>
              Sessions are signed cookies with an eight-hour lifetime and this app keeps no
              server-side list of them. A device that is already signed in keeps working
              until its session expires — signing out everywhere is not something this build
              can do.
            </li>
            <li>
              Every change is written to the audit log (who and when, never what), so a
              password nobody remembers changing is visible there.
            </li>
            <li>
              There is no email reset: no mail is configured, by design. If the password is
              lost, someone with database access resets it.
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}
