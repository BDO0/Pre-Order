/**
 * CSV output, with the escaping rules that actually matter.
 *
 * Written by hand rather than pulled from a library for two reasons that both
 * bite in practice:
 *
 *  1. Customer names and addresses contain commas, quotes and newlines. A field
 *     is quoted only when it needs to be, doubled quotes inside it are escaped,
 *     and any newline is preserved inside the quotes — a spreadsheet reads all
 *     three correctly, while a naive `join(",")` produces a file with columns
 *     that silently shift.
 *  2. A value beginning with `=`, `+`, `-` or `@` is a formula to Excel and
 *     Google Sheets. An Instagram handle starting with "@" would be executed as
 *     one, so those values get a leading apostrophe (the standard defence) —
 *     without it, a customer-typed field would be running in the operator's
 *     spreadsheet.
 */

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/** Neutralises a value that a spreadsheet would otherwise evaluate. */
export function escapeCsvFormula(value: string): string {
  return FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix)) ? `'${value}` : value;
}

/** Renders one cell: quoted when it must be, escaped when it must be. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";

  const raw = typeof value === "number" ? String(value) : escapeCsvFormula(value);

  // Quote if the value could otherwise break the row apart.
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }

  return raw;
}

/** Renders a full sheet. CRLF line endings: the format Excel expects. */
export function toCsv(rows: readonly (readonly (string | number | null)[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
