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
/**
 * The hosts this project treats as "a database on this machine".
 *
 * One definition, used by two callers with opposite needs: `resolveSsl` must not
 * force TLS on a local Postgres (which has it off), and the demo seed must refuse
 * to run against anything but local (see `prisma/seed.ts`). A second copy of this
 * list would sooner or later disagree with this one.
 */
export function isLocalDatabaseHost(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local")
    );
  } catch {
    // Unparseable: not something to write demo data into either way.
    return false;
  }
}

export function resolveSsl(connectionString: string): pg.PoolConfig["ssl"] {
  let sslmode: string | null = null;

  try {
    sslmode = new URL(connectionString).searchParams.get("sslmode");
  } catch {
    return { rejectUnauthorized: false };
  }

  if (sslmode === "disable") return false;
  if (sslmode === "verify-full") return { rejectUnauthorized: true };
  if (sslmode) return { rejectUnauthorized: false };

  return isLocalDatabaseHost(connectionString) ? false : { rejectUnauthorized: false };
}

/**
 * Pool options shared by every entry point (the Next.js runtime and the Prisma
 * seed) so TLS and timeouts behave identically in both. Kept in one place
 * because a divergence here shows up as a confusing connection error in only
 * one of the two.
 */
export function createPoolConfig(connectionString: string): pg.PoolConfig {
  // A serverless platform starts many short-lived instances, and each one used
  // to open up to ten sockets. Behind the Supabase pooler that is wasteful; for
  // a serverless deploy set PGPOOL_MAX=1 and let Supavisor do the multiplexing.
  const configuredMax = Number.parseInt(process.env.PGPOOL_MAX ?? "", 10);
  const max =
    Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 10;

  return {
    connectionString,
    ssl: resolveSsl(connectionString),
    // Fail fast instead of leaving the request hanging forever when the
    // database is unreachable (e.g. a paused Supabase project).
    connectionTimeoutMillis: 10_000,
    max,
  };
}
