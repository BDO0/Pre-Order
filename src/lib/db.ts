import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const { Pool } = pg;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Resolves the TLS settings for a connection string.
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
function resolveSsl(connectionString: string): pg.PoolConfig["ssl"] {
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

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and provide a Postgres connection string."
    );
  }

  const pool = new Pool({
    connectionString,
    ssl: resolveSsl(connectionString),
    // Fail fast instead of leaving the request hanging forever when the
    // database is unreachable (e.g. a paused Supabase project).
    connectionTimeoutMillis: 10_000,
    // Serverless platforms start many short-lived instances; a small pool per
    // instance avoids exhausting the database's connection limit.
    max: 10,
  });
  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
