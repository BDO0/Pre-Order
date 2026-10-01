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

const pool = new Pool(createPoolConfig(connectionString));
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DEFAULT_EMAIL = "admin@anaclothing.com";
const DEFAULT_NAME = "Admin";
const DEFAULT_ROLE = "SUPER_ADMIN";

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
