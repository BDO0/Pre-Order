import type pg from "pg";

/**
 * Resolves the TLS settings for a Postgres connection string.
 *
 * Managed Postgres providers (Supabase, Neon, RDS, ...) require TLS and serve
 * certificates that Node's default trust store does not know, so the
 * connection is refused with:
 *   "no pg_hba.conf entry for host ..., no encryption"
 * A local Postgres normally has TLS disabled, so forcing it there fails too.
 *
 * `sslmode` in the URL wins when present, otherwise TLS is enabled for every
 * non-local host.
 *
 * NOTE: `rejectUnauthorized: false` encrypts the connection but does not
 * verify the server certificate. Pinning the provider's CA bundle is the
 * stronger option once the database provider is final.
 */
export function resolveSsl(connectionString: string): pg.PoolConfig["ssl"] {
  let host = "";
  let sslmode: string | null = null;

  try {
    const url = new URL(connectionString);
    host = url.hostname;
    sslmode = url.searchParams.get("sslmode");
  } catch {
    return { rejectUnauthorized: false };
  }

  if (sslmode === "disable") return false;
  if (sslmode === "verify-full") return { rejectUnauthorized: true };
  if (sslmode) return { rejectUnauthorized: false };

  const isLocalHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local");

  return isLocalHost ? false : { rejectUnauthorized: false };
}

/**
 * Pool options shared by every entry point (the Next.js runtime and the Prisma
 * seed) so TLS and timeouts behave identically in both. Kept in one place
 * because a divergence here shows up as a confusing connection error in only
 * one of the two.
 */
export function createPoolConfig(connectionString: string): pg.PoolConfig {
  return {
    connectionString,
    ssl: resolveSsl(connectionString),
    // Fail fast instead of leaving the request hanging forever when the
    // database is unreachable (e.g. a paused Supabase project).
    connectionTimeoutMillis: 10_000,
    // Serverless platforms start many short-lived instances; a small pool per
    // instance avoids exhausting the database's connection limit.
    max: 10,
  };
}
