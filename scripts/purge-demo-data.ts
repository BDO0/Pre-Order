/**
 * Removes the demo catalogue from a database, with a backup and a guard.
 *
 *   npm run demo:purge                                  # dry run, writes nothing
 *   npm run demo:purge -- --apply --confirm <token>      # delete, with a backup
 *
 * Why this exists: the demo shop (`npm run db:seed:demo`) and the products made
 * by hand while the app was being readied are real, orderable stock. Leaving
 * them in place means the first customer to find the site can reserve a Parka
 * that does not exist.
 *
 * Three things make it safe enough to point at a live database:
 *
 *   • **It plans from the database, not from a list.** `purge-plan.ts` selects
 *     the rows and explains each one; the dry run prints that reasoning, so the
 *     selection can be read before it is acted on.
 *   • **It backs up before it deletes.** Every row it is about to remove, in
 *     full, as JSON plus a `restore.sql`. If the backup cannot be written, the
 *     purge does not start.
 *   • **It refuses to run without `--confirm`.** The token is the project ref
 *     parsed out of `DATABASE_URL` and printed by the dry run, so it cannot be
 *     typed from memory — pointing this at the wrong database takes a copy and
 *     paste from the run you actually read.
 *
 * Exit codes: 0 = done, 1 = an invariant broke or the run failed, 2 = refused.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPoolConfig } from "../src/lib/pg-ssl";
import { describePlan, databaseIdentity, runPurge } from "../src/lib/purge-demo-data";
import { DEMO_BATCH_SLUGS, DEMO_PRODUCT_SLUGS, TEST_HANDLE_PREFIXES } from "../src/lib/purge-plan";

const { Pool } = pg;

/** Kept out of git: it holds customer names and handles (see .gitignore). */
const DEFAULT_BACKUP_DIR = ".purge-backups";

interface PurgeArgs {
  apply: boolean;
  confirm: string;
  backupDir: string;
  keep: string[];
  keepBatch: string[];
  keepHandle: string[];
  keepOrder: string[];
  purgeHandle: string[];
  products: string[];
  batches: string[];
  help: boolean;
}

function parseArgs(argv: string[]): PurgeArgs {
  const args: PurgeArgs = {
    apply: false,
    confirm: "",
    backupDir: DEFAULT_BACKUP_DIR,
    keep: [],
    keepBatch: [],
    keepHandle: [],
    keepOrder: [],
    purgeHandle: [],
    products: [],
    batches: [],
    help: false,
  };

  // `--flag value` and `--flag=value` both work; the `=` form matters on
  // Windows, where npm mangles a bare `--flag=` into something else.
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const equals = raw.indexOf("=");
    const flag = equals === -1 ? raw : raw.slice(0, equals);
    const inline = equals === -1 ? undefined : raw.slice(equals + 1);
    const value = (): string => {
      if (inline !== undefined) return inline;
      index += 1;
      return argv[index] ?? "";
    };

    switch (flag) {
      case "--apply":
        args.apply = true;
        break;
      case "--confirm":
        args.confirm = value();
        break;
      case "--backup":
        args.backupDir = value();
        break;
      case "--keep":
      case "--keep-product":
        args.keep.push(value());
        break;
      case "--keep-batch":
        args.keepBatch.push(value());
        break;
      case "--keep-handle":
        args.keepHandle.push(value().replace(/^@/, ""));
        break;
      case "--keep-order":
        args.keepOrder.push(value());
        break;
      case "--purge-handle":
        args.purgeHandle.push(value().replace(/^@/, ""));
        break;
      case "--product":
        args.products.push(value());
        break;
      case "--batch":
        args.batches.push(value());
        break;
      case "-h":
      case "--help":
      case "help":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${raw}. Try --help.`);
    }
  }

  return args;
}

function usage(): string {
  return [
    "Remove the demo catalogue, with a backup.",
    "",
    "Usage:",
    "  npm run demo:purge                              dry run: prints what would go",
    "  npm run demo:purge -- --apply --confirm <token>  delete it, after a backup",
    "",
    "Options:",
    "  --apply                 Delete the rows. Without it, nothing is written.",
    "  --confirm <token>       Required with --apply. The project ref (or host)",
    "                          from the dry run's header — copy it, do not recall it.",
    "  --backup <dir>          Where the backup goes (default ./" + DEFAULT_BACKUP_DIR + ").",
    "  --keep <slug>           Keep a product the purge would otherwise remove.",
    "  --keep-batch <slug>     Keep a batch.",
    "  --keep-order <ref>      Keep an order whose items are all demo stock.",
    "  --keep-handle <handle>  Keep a customer.",
    "  --purge-handle <handle> Remove a customer that has no orders at all.",
    "  --product <slug>        Purge exactly these products instead of the list",
    "                          below (repeatable, replaces the default list).",
    "  --batch <slug>          Purge exactly these batches instead (repeatable).",
    "  -h, --help              This text.",
    "",
    "Default targets:",
    `  products  ${DEMO_PRODUCT_SLUGS.join(", ")}`,
    `  batches   ${DEMO_BATCH_SLUGS.join(", ")}`,
    `  customers handle prefixes ${TEST_HANDLE_PREFIXES.join(", ")} (test rows only)`,
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and provide a Postgres connection string."
    );
  }

  const identity = databaseIdentity(connectionString);

  // The guard. It is deliberately checked here, before a client is even built:
  // an `--apply` aimed at the wrong database should not get as far as opening a
  // connection, let alone reading rows.
  if (args.apply && args.confirm.toLowerCase() !== identity.confirmToken.toLowerCase()) {
    console.error("Refusing to apply: --confirm does not name the database in DATABASE_URL.\n");
    console.error(`  DATABASE_URL is     ${identity.host}/${identity.database}`);
    console.error(`  --confirm should be ${identity.confirmToken}`);
    console.error(`  --confirm was       ${args.confirm || "(nothing)"}`);
    console.error("\nRun the dry run first: its header prints the token to repeat.");
    process.exitCode = 2;
    return;
  }

  // The same pool and TLS settings as the app and the audit, so a purge can
  // never be an artefact of different connection options.
  const pool = new Pool(createPoolConfig(connectionString));
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool), log: ["error"] });

  try {
    const report = await runPurge(prisma, connectionString, {
      apply: args.apply,
      backupDir: args.backupDir,
      keepProductSlugs: args.keep,
      keepBatchSlugs: args.keepBatch,
      keepHandles: args.keepHandle,
      keepOrderRefs: args.keepOrder,
      purgeHandles: args.purgeHandle,
      productSlugs: args.products.length > 0 ? args.products : undefined,
      batchSlugs: args.batches.length > 0 ? args.batches : undefined,
      log: (line) => console.log(`  .. ${line}`),
    });

    console.log("");
    for (const line of describePlan(report.plan, report.identity, report.applied)) {
      console.log(line);
    }

    if (report.applied) {
      console.log("");
      console.log("deleted");
      for (const [table, count] of Object.entries(report.deleted)) {
        console.log(`  ${table.padEnd(22)} ${String(count).padStart(5)}`);
      }

      if (report.capacityUpdates.length > 0) {
        console.log("");
        console.log("capacity re-derived from the orders that survived");
        for (const update of report.capacityUpdates) {
          console.log(`  ${update.kind.padEnd(7)} ${update.label}: ${update.from} -> ${update.to}`);
        }
      }

      if (report.backup) {
        console.log("");
        console.log(`backup  ${report.backup.dir}`);
        console.log(`        ${report.backup.files.join(", ")}`);
      }
    }

    console.log("");
    console.log("capacity rules");
    for (const finding of report.findings) {
      const detail = finding.detail ? ` -- ${finding.detail}` : "";
      console.log(finding.pass ? `  PASS  ${finding.rule}` : `  FAIL  ${finding.rule}${detail}`);
    }
    if (!report.countersUnchanged) {
      console.log("  FAIL  order reference counters are unchanged -- read manifest.json before doing anything");
    }

    const failed = report.findings.filter((finding) => !finding.pass).length;

    if (!report.applied) {
      console.log("");
      console.log("Nothing was written. To delete exactly this:");
      console.log(`  npm run demo:purge -- --apply --confirm ${report.identity.confirmToken}`);
      return;
    }

    if (failed > 0 || !report.countersUnchanged) {
      console.log("");
      console.log("The purge ran, and the database does not satisfy every rule. The backup is at:");
      console.log(`  ${report.backup?.dir ?? "(no backup)"}`);
      process.exitCode = 1;
      return;
    }

    console.log("");
    console.log("Done: every invariant still holds and the reference counters did not move.");
    console.log("Next: `npm run db:check`, then add the real catalogue in the admin panel.");
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("\nPurge failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
