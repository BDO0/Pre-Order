/**
 * Reading and describing the operator-defined answers stored on an order.
 *
 * Client-safe on purpose: the admin order screen and the redaction helper both
 * need to walk a snapshot, and neither may drag Prisma into the browser bundle.
 * `order-form.ts` holds the server-only half (field definitions, validation).
 */

import { OrderError } from "@/lib/order-error";
import type { FormFieldType } from "@prisma/client";

/**
 * One answered field, as stored in `orders.customerSnapshot.answers`.
 *
 * Declared as a type alias rather than an interface on purpose: a type alias
 * gets an implicit index signature, which is what makes an array of these
 * assignable to Prisma's `InputJsonValue` when the snapshot is written.
 */
export type SnapshotAnswer = {
  key: string;
  label: string;
  type: FormFieldType;
  value: string;
  /** Whether the definition was marked sensitive when this answer was written. */
  sensitive: boolean;
};

/** A field as the checkout page (and the admin list) sees it. */
export interface PublicFormField {
  key: string;
  label: string;
  type: FormFieldType;
  placeholder: string | null;
  helpText: string | null;
  required: boolean;
  options: string[];
}

/** A field as a human administers it. */
export interface AdminFormField extends PublicFormField {
  id: string;
  sensitive: boolean;
  sortOrder: number;
  active: boolean;
  deletedAt: Date | null;
  updatedAt: Date;
}

/** Human labels for the field types, shared by the admin editor and the form. */
export const FORM_FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  TEXT: "Short text",
  TEXTAREA: "Long text",
  PHONE: "Phone number",
  EMAIL: "Email address",
  NUMBER: "Number",
  SELECT: "Dropdown",
};

/** Drops the admin-only properties, so an API response cannot leak them. */
export function toPublicField(field: {
  key: string;
  label: string;
  type: FormFieldType;
  placeholder: string | null;
  helpText: string | null;
  required: boolean;
  options: string[];
}): PublicFormField {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    placeholder: field.placeholder,
    helpText: field.helpText,
    required: field.required,
    options: field.options,
  };
}

/**
 * Reads the answers back out of a stored snapshot, tolerating every shape this
 * app has ever written (a JSON column is not a typed column).
 */
export function readSnapshotAnswers(snapshot: unknown): SnapshotAnswer[] {
  if (!snapshot || typeof snapshot !== "object") return [];
  const answers = (snapshot as { answers?: unknown }).answers;
  if (!Array.isArray(answers)) return [];

  return answers.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const entry = raw as Partial<SnapshotAnswer>;
    if (typeof entry.key !== "string" || typeof entry.label !== "string") return [];
    if (entry.value === undefined || entry.value === null) return [];
    return [
      {
        key: entry.key,
        label: entry.label,
        type: (entry.type ?? "TEXT") as FormFieldType,
        value: String(entry.value),
        sensitive: entry.sensitive === true,
      },
    ];
  });
}

/** The customer's name as written on the order, or a dash for a legacy row. */
export function snapshotFullName(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const value = (snapshot as { fullName?: unknown }).fullName;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The customer's normalised Instagram handle as written on the order. */
export function snapshotInstagramHandle(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const value = (snapshot as { instagramHandle?: unknown }).instagramHandle;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

// ─────────────────────────────────────────────────────────────
// ANSWER VALIDATION
// ─────────────────────────────────────────────────────────────

/** Longest answer kept, mirroring the zod ceiling on `answers[].value`. */
export const MAX_ANSWER_LENGTH = 2000;

/** Deliberately permissive: numbers are written in too many local formats. */
const PHONE_PATTERN = /^[+]?[\d\s().-]{7,20}$/;

/**
 * Turns submitted answers into the snapshot that is written onto the order.
 *
 * Rules, in the order they matter:
 *  - an answer for a field that is not on the form is rejected, so a crafted
 *    payload cannot inject arbitrary keys into the snapshot;
 *  - a required field must be answered;
 *  - a value that does not fit its field type is rejected, because a bad phone
 *    number is exactly the thing the operator would otherwise discover in DM;
 *  - whitespace-only answers count as unanswered, and unanswered optional fields
 *    are left out entirely rather than stored as empty strings.
 *
 * Pure: the field definitions are passed in, so this module stays importable from
 * a test or a component without a database connection.
 */
export function buildSnapshotAnswers(
  fields: readonly (PublicFormField & { sensitive: boolean })[],
  submitted: readonly { fieldId: string; value: string }[]
): SnapshotAnswer[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const answers: SnapshotAnswer[] = [];
  const seen = new Set<string>();

  const reject = (label: string, detail: string, code: string): never => {
    throw new OrderError(code, `"${label}" ${detail}`);
  };

  for (const entry of submitted) {
    const field = byKey.get(entry.fieldId);

    if (!field) {
      throw new OrderError(
        "INVALID_FORM_FIELD",
        "This form has changed since the page was opened. Please reload and try again."
      );
    }

    if (seen.has(entry.fieldId)) {
      throw new OrderError(
        "DUPLICATE_FORM_ANSWER",
        `"${field.label}" was submitted twice.`
      );
    }
    seen.add(entry.fieldId);

    // `let` because a dropdown answer is canonicalised below: the stored value is
    // the spelling the field offers, not the spelling the payload used.
    let value = entry.value.trim();

    if (value === "") {
      if (field.required) reject(field.label, "is required.", "FORM_FIELD_REQUIRED");
      continue;
    }

    if (value.length > MAX_ANSWER_LENGTH) {
      reject(field.label, "is too long.", "FORM_ANSWER_TOO_LONG");
    }

    switch (field.type) {
      case "EMAIL":
        // The same rule as the browser's type="email", enforced where it counts.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          reject(field.label, "must be a valid email address.", "FORM_ANSWER_INVALID");
        }
        break;
      case "PHONE":
        if (!PHONE_PATTERN.test(value)) {
          reject(field.label, "must be a valid phone number.", "FORM_ANSWER_INVALID");
        }
        break;
      case "NUMBER":
        if (!Number.isFinite(Number(value))) {
          reject(field.label, "must be a number.", "FORM_ANSWER_INVALID");
        }
        break;
      case "SELECT": {
        // Matched case-insensitively, so a stale option list cannot reject a valid
        // choice over capitalisation. What is *stored*, though, is the operator's
        // spelling and not the customer's: this value is rendered back on the order
        // screen, and an answer reading "medium" under a field that offers "Medium"
        // is the shop's own data contradicting itself. Nothing legitimate can
        // differ anyway — a dropdown offers one spelling — so a payload that
        // disagrees is either a cached page or a hand-rolled request, and either
        // way the honest record is what the form would have shown.
        const option = field.options.find(
          (candidate) => candidate.toLowerCase() === value.toLowerCase()
        );

        if (option === undefined) {
          // `return`, not a bare call: `reject` is typed `never`, and this is what
          // lets the assignment below read a value the compiler knows is a string.
          return reject(
            field.label,
            "must be one of the listed options.",
            "FORM_ANSWER_INVALID"
          );
        }

        value = option;
        break;
      }
      default:
        break;
    }

    answers.push({
      key: field.key,
      label: field.label,
      type: field.type,
      value,
      sensitive: field.sensitive,
    });
  }

  // Required fields that were never submitted at all (a hand-rolled payload, not
  // the form) are caught here — the loop above only sees what was sent.
  for (const field of fields) {
    if (field.required && !seen.has(field.key)) {
      reject(field.label, "is required.", "FORM_FIELD_REQUIRED");
    }
  }

  return answers;
}

