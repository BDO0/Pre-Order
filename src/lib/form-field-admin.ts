import type { FormFieldType } from "@prisma/client";

/**
 * Small helpers for administering the pre-order form.
 *
 * Pure, so the admin editor and the API agree on what a field definition means
 * without either one dragging Prisma into the browser bundle.
 */

/** Types whose options are meaningless; keeping them would confuse the editor. */
export function normaliseFieldOptions(
  type: FormFieldType,
  options: readonly string[]
): string[] {
  if (type !== "SELECT") return [];

  // De-duplicated case-insensitively (Instagram-style "Black" vs "black" is one
  // choice, not two) while keeping the operator's original spelling and order.
  const seen = new Set<string>();
  const result: string[] = [];

  for (const option of options) {
    const trimmed = option.trim();
    if (trimmed === "") continue;
    const fingerprint = trimmed.toLowerCase();
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    result.push(trimmed);
  }

  return result;
}

/** True when a field can be deleted without losing anything an answer needs. */
export function isDeletableField(field: {
  deletedAt: Date | string | null;
}): boolean {
  return field.deletedAt === null;
}

/** The human word for a field's state in the admin list. */
export function describeFieldState(field: {
  active: boolean;
  deletedAt: Date | string | null;
}): "Deleted" | "Hidden" | "Live" {
  if (field.deletedAt) return "Deleted";
  return field.active ? "Live" : "Hidden";
}
