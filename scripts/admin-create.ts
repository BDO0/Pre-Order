/**
 * Create, update or reset one admin account.
 *
 *   npm run admin:create -- --email ana@example.com --role ORDER_MANAGER
 *   npm run admin:create -- --email ana@example.com --password "correct horse battery"
 *   npm run admin:create -- --email ana@example.com --reset-password
 *
 * What this is for, and why it is not `db:seed`:
 *
 *   • **Adding a colleague.** The seed creates the first account. A shop with
 *     two people packing orders needs a second one, and the only other way to
 *     get it is `prisma studio` — a tool this project's docs tell operators to
 *     keep away from.
 *   • **Recovering a lost password.** There is no email reset (no mail is
 *     configured, deliberately), so the recovery path is a shell and a
 *     connection string. That path should be one command, not a hand-written
 *     UPDATE with a bcrypt hash pasted into it.
 *
 * Properties it keeps, because it runs against a live database:
 *
 *   • **Nothing changes that you did not ask for.** Only the flags you pass are
 *     written; a run that supplies no `--password` never resets one.
 *   • **One password policy.** `passwordProblem` is the same function the
 *     change-password endpoint refuses a password with, so this cannot create an
 *     account the app would not have accepted.
 *   • **Audited.** A created, renamed, re-roled or reset account leaves an
 *     `audit_logs` row. A password nobody remembers resetting is exactly the
 *     thing that log exists to make visible.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, type AdminRole } from "@prisma/client";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPoolConfig } from "../src/lib/pg-ssl";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  generatePassword,
  passwordProblem,
} from "../src/lib/admin-password";
import { isKnownRole, ROLE_LABELS } from "../src/lib/permissions";

const { Pool } = pg;

/**
 * Opens the connection on demand.
 *
 * `--help` and a mistyped flag must work on a laptop with no `.env` at all, so
 * nothing here reads `DATABASE_URL` until a command has been found valid and
 * there is actually something to write.
 */
let prismaClient: PrismaClient | null = null;
let pool: pg.Pool | null = null;

function db(): PrismaClient {
  if (prismaClient) return prismaClient;

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and provide a Postgres connection string."
    );
  }

  // Same pool and TLS settings as the app, the seed and `db:check`
  // (src/lib/pg-ssl): a connection that works there must not fail here for its
  // own reasons.
  pool = new Pool(createPoolConfig(connectionString));
  prismaClient = new PrismaClient({ adapter: new PrismaPg(pool), log: ["error"] });

  return prismaClient;
}

/** `bcrypt.cost`. Also hard-coded in the change-password route; both must match. */
const BCRYPT_ROUNDS = 12;

/** Printed when the command is run with no arguments, or with `--help`. */
const USAGE = `
Create or update an admin account.

  npm run admin:create -- --email <address> [options]

Options
  --email <address>    Required. The account to create or update.
  --name <name>        Display name. Defaults to the part before the @.
  --role <role>        ${Object.keys(ROLE_LABELS).join(" | ")}
                       Defaults to ADMIN. Use SUPER_ADMIN for the shop owner.
  --password <value>   Set or reset the password (${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters).
                       The value ends up in your shell history.
  --reset-password     Replace the password with a generated one and print it
                       once. This is the recovery path for an account that
                       already exists, and the value never touches your shell
                       history - which "--password" cannot promise.
  --help               Show this text.

Creating an account needs neither flag: with neither, a password is generated
and printed once. Passing --reset-password and --password together is refused
rather than arbitrated, since one of the two would silently win.

Every option that takes a value also reads from the environment (ADMIN_EMAIL,
ADMIN_NAME, ADMIN_ROLE, ADMIN_PASSWORD); an explicit flag wins.

Examples
  npm run admin:create -- --email ana@example.com
  npm run admin:create -- --email ana@example.com --role ORDER_MANAGER
  npm run admin:create -- --email ana@example.com --password "correct horse battery"
  npm run admin:create -- --email ana@example.com --reset-password
`.trim();

interface Options {
  email: string;
  name?: string;
  role?: string;
  password?: string;
  /**
   * Replace the password with a freshly generated one.
   *
   * Separate from `password` because it takes no value: it exists so the recovery
   * path does not force a secret through `--password`, where it would be recorded
   * in the shell's history file.
   */
  resetPassword: boolean;
}

/** Flags that carry a value. */
const VALUE_FLAGS = ["email", "name", "role", "password"];
/** Flags that are switches. */
const BOOLEAN_FLAGS = ["reset-password"];
const KNOWN_FLAGS = [...VALUE_FLAGS, ...BOOLEAN_FLAGS];

/** Parses `--flag value`, `--flag=value` and the switch flags, and reports anything unexpected. */
function parseArgs(argv: string[]): { help: boolean; options: Options; errors: string[] } {
  const flags = new Map<string, string>();
  const errors: string[] = [];
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      errors.push(`Unexpected argument "${arg}".`);
      continue;
    }

    const body = arg.slice(2);
    const equals = body.indexOf("=");
    const name = equals === -1 ? body : body.slice(0, equals);

    if (!KNOWN_FLAGS.includes(name)) {
      errors.push(`Unknown flag "--${name}".`);
      continue;
    }

    // A switch: `--reset-password=1` is a misunderstanding of it, and accepting
    // the value would suggest it means something.
    if (BOOLEAN_FLAGS.includes(name)) {
      if (equals !== -1) {
        errors.push(`"--${name}" does not take a value.`);
        continue;
      }
      flags.set(name, "true");
      continue;
    }

    if (equals !== -1) {
      flags.set(name, body.slice(equals + 1));
      continue;
    }

    // A value is required, and it must not be the next flag: `--email --name x`
    // has to fail loudly rather than create an account called "--name".
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      errors.push(`"--${name}" needs a value.`);
      continue;
    }
    flags.set(name, value);
    index += 1;
  }

  const env = (name: string) => {
    const value = process.env[name]?.trim();
    return value === "" ? undefined : value;
  };

  return {
    help,
    errors,
    options: {
      email: (flags.get("email") ?? env("ADMIN_EMAIL") ?? "").trim(),
      name: flags.get("name") ?? env("ADMIN_NAME"),
      role: flags.get("role") ?? env("ADMIN_ROLE"),
      password: flags.get("password") ?? env("ADMIN_PASSWORD"),
      resetPassword: flags.has("reset-password"),
    },
  };
}


async function main(): Promise<void> {
  const { help, options, errors } = parseArgs(process.argv.slice(2));

  // No arguments at all is far more likely to mean "how does this work?" than
  // "create an account with no email", and it is also the only way to ask on a
  // terminal where `npm run admin:create -- --help` gets eaten by npm itself.
  if (help || process.argv.length <= 2) {
    console.log(USAGE);
    return;
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`❌ ${error}`);
    console.error(`\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const email = options.email.toLowerCase();

  if (email === "") {
    console.error("❌ An email address is required: --email <address>");
    console.error(`\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`❌ "${email}" is not an email address.`);
    process.exitCode = 1;
    return;
  }

  if (options.role !== undefined && !isKnownRole(options.role)) {
    console.error(
      `❌ "${options.role}" is not a role this app knows. ` +
        `Use one of ${Object.keys(ROLE_LABELS).join(", ")}.`
    );
    process.exitCode = 1;
    return;
  }

  if (options.password === "") {
    console.error(
      "❌ The password cannot be empty. Omit --password entirely to have one generated."
    );
    process.exitCode = 1;
    return;
  }

  if (options.password !== undefined) {
    const problem = passwordProblem(options.password);
    if (problem) {
      console.error(`❌ That password cannot be used. ${problem}`);
      process.exitCode = 1;
      return;
    }
  }

  if (options.resetPassword && options.password !== undefined) {
    console.error(
      "❌ --reset-password generates a new password, --password sets a specific one. Pass one, not both."
    );
    process.exitCode = 1;
    return;
  }

  // The schema's own default, and deliberately not SUPER_ADMIN: adding a
  // colleague should not hand them the ability to add colleagues. `isKnownRole`
  // is the check that already rejected an unknown --role above; going through it
  // again is what keeps this value typed as a role rather than as a string.
  const role = isKnownRole(options.role) ? options.role : "ADMIN";
  const name = options.name?.trim() || email.split("@")[0];

  // Connected only now: everything above is an argument check, and a typo in an
  // email address must not need a reachable database to be reported.
  const prisma = db();

  console.log("Admin account");
  console.log(`Target: ${email}`);

  const existing = await prisma.admin.findUnique({ where: { email } });

  // `--reset-password` means "no password was supplied" on the create path, and
  // on the update path it is what makes the generated value get written rather
  // than merely printed.
  const providedPassword = options.resetPassword ? undefined : options.password;
  const generated = providedPassword === undefined ? generatePassword() : null;
  // Hashed once, before the branch: bcrypt takes ~100ms and neither path writes
  // until it has something to write.
  const passwordHash = await bcrypt.hash(providedPassword ?? generated!, BCRYPT_ROUNDS);

  if (!existing) {
    const created = await prisma.$transaction(async (tx) => {
      const admin = await tx.admin.create({
        data: { email, name, role, passwordHash },
      });

      await tx.auditLog.create({
        data: {
          // A person at a shell, not the new account: attributing this to the
          // account would make the log claim its owner created themselves.
          actor: "cli:admin-create",
          action: "admin.created",
          metadata: { email: admin.email, role: admin.role },
        },
      });

      return admin;
    });

    console.log(`\n✅ Created ${ROLE_LABELS[created.role]}: ${created.email}`);
    console.log("\n   Sign in at /admin/login with:");
    console.log(`     Email:    ${created.email}`);
    console.log(`     Password: ${providedPassword ?? generated}`);
    if (generated) {
      console.log("\n   ⚠️  This is the only time that password is printed. Save it now —");
      console.log("      only the bcrypt hash is stored.");
    }
    console.log("   They can change it after signing in (Admin → Account).");
    return;
  }


  // ── Existing account: only what was explicitly asked for ────────────────
  const changed: string[] = [];
  const data: { passwordHash?: string; name?: string; role?: AdminRole } = {};

  if (providedPassword !== undefined || options.resetPassword) {
    data.passwordHash = passwordHash;
    changed.push("password");
  }
  if (options.name !== undefined && name !== existing.name) {
    data.name = name;
    changed.push("name");
  }
  if (options.role !== undefined && role !== existing.role) {
    data.role = role;
    changed.push("role");
  }

  // Nothing was asked for that this account does not already have. Reported
  // rather than treated as an error: "it already is that way" is a successful
  // outcome for a script somebody runs twice.
  if (changed.length === 0) {
    console.log(`\n✅ ${existing.email} already exists — nothing changed.`);
    console.log(`   Name:   ${existing.name}`);
    console.log(`   Role:   ${ROLE_LABELS[existing.role]}`);
    console.log(`   Active: ${existing.active ? "yes" : "NO — sign-in is blocked"}`);
    console.log("\n   Password: unchanged. To replace it with a generated one:");
    console.log(`     npm run admin:create -- --email ${existing.email} --reset-password`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.admin.update({ where: { id: existing.id }, data });

    await tx.auditLog.create({
      data: {
        actor: "cli:admin-create",
        action: changed.includes("password") ? "admin.password_reset" : "admin.updated",
        // Who, when, and which fields moved. Never the password, not even as a
        // hash.
        oldValue: { name: existing.name, role: existing.role },
        newValue: {
          name: data.name ?? existing.name,
          role: data.role ?? existing.role,
        },
        metadata: { email: existing.email, changed },
      },
    });
  });

  console.log(`\n✅ Updated ${existing.email}: ${changed.join(", ")}.`);
  if (data.passwordHash !== undefined) {
    console.log(`   New password: ${providedPassword ?? generated}`);
    if (providedPassword === undefined) {
      console.log("   ⚠️  This is the only time that password is printed. Save it now —");
      console.log("      only the bcrypt hash is stored.");
    }
  }
  if (changed.includes("role")) {
    console.log(`   Role is now ${ROLE_LABELS[role]}.`);
  }
  if (!existing.active) {
    console.log(
      "\n   ⚠️  This account is deactivated, so the new password still cannot be used."
    );
    console.log("      Reactivate it in Prisma Studio or directly in the database.");
  }
}


main()
  .catch((error) => {
    console.error(`\n❌ ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Both are null when the command never needed a connection (no arguments,
    // `--help`, a rejected flag), so the cleanup is optional on purpose.
    await prismaClient?.$disconnect();
    await pool?.end();
  });

