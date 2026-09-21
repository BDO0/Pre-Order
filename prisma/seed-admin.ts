/**
 * Creates the one account you need before the admin panel is reachable, and
 * nothing else.
 *
 *   npm run db:seed
 *
 * This is what `db:seed` and `prisma db seed` run, because a migrated database
 * with no admin is a dead end: `/admin/login` has nobody to log in as, and the
 * only other way in is a shell with database credentials. The demo shop — fake
 * products, a live batch, a published password — is a separate, local-only
 * script (`npm run db:seed:demo`, `prisma/seed.ts`).
 *
 * Three properties this script is careful about, because it runs both on a
 * laptop and on the production database:
 *
 *   • **Idempotent in the safe direction.** An existing account is reported and
 *     left exactly as it is: no password reset, no role change, no re-activation.
 *     Re-running setup must never be able to lock the operator out, nor silently
 *     restore access to an account somebody deliberately disabled.
 *   • **The password is either yours or newly random.** `ADMIN_PASSWORD` when it
 *     passes the same policy the app enforces, otherwise one is generated and
 *     printed once. There is no built-in default for anyone to guess.
 *   • **It never prints a password it does not know.** "Password: (unchanged)"
 *     is the truth; a plausible-looking placeholder would be worse than nothing.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPoolConfig } from "../src/lib/pg-ssl";
import { generatePassword, passwordProblem } from "../src/lib/admin-password";
import { isKnownRole, ROLE_LABELS } from "../src/lib/permissions";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and provide a Postgres connection string."
  );
}

// The same pool and TLS settings as the app, the demo seed and `db:check`, so a
// connection that works there cannot fail here for its own reasons.
const pool = new Pool(createPoolConfig(connectionString));
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DEFAULT_EMAIL = "admin@anaclothing.com";
const DEFAULT_NAME = "Admin";
const DEFAULT_ROLE = "SUPER_ADMIN";

/** Trimmed environment value, or `undefined` when unset/blank. */
function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
}

async function main() {
  const email = (env("ADMIN_EMAIL") ?? DEFAULT_EMAIL).toLowerCase();
  const name = env("ADMIN_NAME") ?? DEFAULT_NAME;
  const role = env("ADMIN_ROLE") ?? DEFAULT_ROLE;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`ADMIN_EMAIL is not an email address: "${email}".`);
  }

  // Checked before `prisma.admin.create`, because the column is an enum: Prisma
  // would reject it with a raw database error rather than a sentence.
  if (!isKnownRole(role)) {
    throw new Error(
      `ADMIN_ROLE is not a role this app knows: "${role}". ` +
        `Use one of ${Object.keys(ROLE_LABELS).join(", ")}.`
    );
  }

  console.log("🔐 Admin seed");
  console.log(`   Target: ${email}\n`);

  const existing = await prisma.admin.findUnique({ where: { email } });

  if (existing) {
    console.log(`✅ ${existing.email} already exists — nothing changed.`);
    console.log(`   Name:   ${existing.name}`);
    console.log(`   Role:   ${ROLE_LABELS[existing.role]}`);
    console.log(`   Active: ${existing.active ? "yes" : "NO — sign-in is blocked"}`);
    console.log("\n   Password: (unchanged — this script never resets one)");
    console.log("   To reset it deliberately, or to add a colleague:");
    console.log(`     npm run admin:create -- --email ${existing.email} --reset-password`);
    return;
  }

  const provided = env("ADMIN_PASSWORD");
  if (provided) {
    const problem = passwordProblem(provided);
    if (problem) {
      throw new Error(`ADMIN_PASSWORD cannot be used. ${problem}`);
    }
  }

  const generated = provided ? null : generatePassword();
  const password = provided ?? generated!;

  const admin = await prisma.admin.create({
    data: {
      email,
      name,
      role,
      passwordHash: await bcrypt.hash(password, 12),
    },
  });

  console.log(`✅ Created ${ROLE_LABELS[admin.role]}: ${admin.email}`);
  console.log("\n   Sign in at /admin/login with:");
  console.log(`     Email:    ${admin.email}`);
  console.log(`     Password: ${password}`);

  if (generated) {
    console.log(
      "\n   ⚠️  This is the only time that password is printed. Save it in your"
    );
    console.log("      password manager now — it is not stored anywhere in readable form.");
  }

  console.log(
    "\n   You can change it once signed in (Admin → Account → Change Password)."
  );
  console.log("   Restart the app if it was already running.");
}

main()
  .catch((error) => {
    console.error(`\n❌ ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
