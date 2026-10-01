import { randomBytes } from "node:crypto";// Capability token for a private order link: 192 bits of entropy, stored uniquely
// on Order.accessToken, so possessing the link is the only thing needed to read
// that order.
//
// There is deliberately no expiry yet, and that is a known gap rather than an
// oversight: a leaked link (a forwarded DM, a screenshot, a shared phone) stays
// valid forever, and the only revocation available today is rotating the token on
// the order. Adding an expiry needs both a column and a product decision about how
// long a customer may keep reading a past order, so it is recorded here instead of
// being half-implemented.
export const ACCESS_TOKEN_BYTES = 24;const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;export function generateAccessToken(): string {  return randomBytes(ACCESS_TOKEN_BYTES).toString("base64url");}export function isAccessTokenShaped(value: unknown): value is string {  return typeof value === "string" && ACCESS_TOKEN_PATTERN.test(value);}