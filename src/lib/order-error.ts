/**
 * The error type the order pipeline raises for anything the customer can fix.
 *
 * Lives in its own module so `order-form.ts` can throw it without importing
 * `order-service.ts`, which imports `order-form.ts` — a cycle that would have
 * been resolved at runtime by whichever module happened to load second.
 */
export class OrderError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "OrderError";
  }
}
