import { randomBytes } from "node:crypto";

/**
 * The order's access token.
 *
 * This is a *capability URL*: whoever holds the token can read that one order,
 * and nothing else. That makes its entropy the whole security model — a
 * guessable token leaks a stranger's name, handle and order.
 *
 * 24 bytes (192 bits) of CSPRNG output, base64url-encoded. That is the same
 * order of magnitude as a session id, and far beyond guessing: an attacker
 * spraying a million tokens a second would need longer than the age of the
 * universe to have an even chance at one.
 *
 * base64url (not base64) because the token travels in a query string, where
 * `+` and `/` would need escaping — and a link that changes shape when it is
 * pasted into an Instagram DM is a link that breaks.
 */

/** 24 bytes = 192 bits. */
export const ACCESS_TOKEN_BYTES = 24;

/**
 * What a token generated here looks like: 32 base64url characters, nothing else.
 *
 * Used to reject an obviously-wrong `?token=` before it reaches the database,
 * so the lookup endpoint cannot be used to probe with arbitrary strings.
 * Deliberately a shape check, never a bearer of trust.
 */
const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/** Mints a new order access token. */
export function generateAccessToken(): string {
  return randomBytes(ACCESS_TOKEN_BYTES).toString("base64url");
}

/** True when `value` is shaped like a token this app could have minted. */
export function isAccessTokenShaped(value: unknown): value is string {
  return typeof value === "string" && ACCESS_TOKEN_PATTERN.test(value);
}
