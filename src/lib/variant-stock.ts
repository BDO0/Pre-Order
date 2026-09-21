/**
 * "How much is left?" for one product, in the words the admin tables show it.
 *
 * The three edge cases are the reason this is a function rather than an inline
 * `reduce` in a table cell:
 *
 *   • **Retired variants do not count.** A variant is retired, not deleted, so
 *     counting the rows would report stock nobody can buy. This is what made the
 *     products table read "5 variants" for a product with two live sizes.
 *   • **No capacity means unlimited.** `null` is not zero, and "0 / 0" would read
 *     as "sold out" for a product that can sell any number.
 *   • **Mixed is stated, not averaged.** A product with two limited sizes and one
 *     unlimited one has no single number: the sum covers what is capped, and the
 *     uncapped ones are named.
 *
 * Pure, so the products table, the dashboard and a test all read the same rule.
 */
export interface StockCountableVariant {
  /** `undefined` counts as active: an API that omits the flag means "not retired". */
  active?: boolean;
  capacity?: number | null;
  remainingCapacity?: number | null;
}

/** e.g. `12 / 20`, `12 / 20 (+3 unlimited)`, `unlimited`, or `—` for no live variants. */
export function stockSummary(variants: readonly StockCountableVariant[] | undefined): string {
  const live = (variants ?? []).filter((variant) => variant.active !== false);
  if (live.length === 0) return "—";

  const capped = live.filter(
    (variant) => typeof variant.capacity === "number" && typeof variant.remainingCapacity === "number"
  );
  if (capped.length === 0) return "unlimited";

  const remaining = capped.reduce((sum, variant) => sum + (variant.remainingCapacity ?? 0), 0);
  const capacity = capped.reduce((sum, variant) => sum + (variant.capacity ?? 0), 0);
  const uncapped = live.length - capped.length;

  return `${remaining} / ${capacity}${uncapped > 0 ? ` (+${uncapped} unlimited)` : ""}`;
}

/** How many variants a shopper can actually choose from. */
export function activeVariantCount(
  variants: readonly StockCountableVariant[] | undefined
): number {
  return (variants ?? []).filter((variant) => variant.active !== false).length;
}

/** That count as a label — `2 variants`, `1 variant` — plural-safe. */
export function variantCountLabel(
  variants: readonly StockCountableVariant[] | undefined
): string {
  const count = activeVariantCount(variants);
  return `${count} ${count === 1 ? "variant" : "variants"}`;
}
