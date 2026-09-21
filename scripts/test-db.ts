/**
 * A throwaway Postgres, so the integration tests can actually run.
 *
 *   npm run test:db                      # the whole suite, against a temp database
 *   npm run test:db -- tests/order-concurrency.test.ts
 *   npm run dev:local                    # the same database, with `next dev` and demo data
 *
 * Why this exists. `tests/order-concurrency.test.ts` is the acceptance gate for
 * the atomic-capacity work in `src/lib/order-service.ts` — the code whose failure
 * mode is an oversold batch. It needs a real Postgres, and without
 * `TEST_DATABASE_URL` it reports itself as skipped, so for as long as nobody had
 * a spare database it was passing by not running. Pointing it at the store's own
 * database is not an option: the suite creates batches, orders and customers, and
 * the store's database holds real orders.
 *
 * What this does, in order:
 *
 *   1. Boots a private Postgres cluster from the binaries in the
 *      `embedded-postgres` package, on a free port, in `node_modules/.cache`.
 *      Nothing is installed system-wide, no service is registered, and no
 *      existing database is touched.
 *   2. Applies `prisma/migrations` to it. That is worth having on its own: it is
 *      the only place the migration history is replayed onto an empty database,
 *      which is what a from-scratch deploy does.
 *   3. Runs the suite with `TEST_DATABASE_URL` *and* `DATABASE_URL` pointing at
 *      the cluster. Both, not just the first: `@/lib/db` reads `DATABASE_URL` when
 *      it is first imported, and a test file that only imports it transitively
 *      would otherwise aim a pool at whatever `.env` holds. With both overridden,
 *      nothing in the test process can reach a real database.
 *   4. Deletes the cluster, including when the tests fail. On Windows that delete
 *      can need a second attempt or two: the directory stays locked for a moment
 *      after Postgres has exited, so it is retried rather than left behind.
 *
 * The data directory is wiped on every run, so a run that failed halfway cannot
 * leave behind a cluster that makes the next one fail for a different reason.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { once } from "node:events";
import EmbeddedPostgres from "embedded-postgres";

/** Where the cluster lives. Under `node_modules` so it is scratch by construction. */
const DATA_DIR = resolve("node_modules/.cache/preorder-test-db");
/** A name that cannot be mistaken for the store's own database. */
const DATABASE_NAME = "preorder_test";
const PRISMA_CLI = resolve("node_modules/prisma/build/index.js");
const VITEST_CLI = resolve("node_modules/vitest/vitest.mjs");
const NEXT_CLI = resolve("node_modules/next/dist/bin/next");

const USAGE = `
Run the test suite against a throwaway Postgres.

  npm run test:db [-- <vitest arguments>]
  npm run dev:local

Options
  --serve        Run \`next dev\` against the throwaway database instead of the
                 tests, seeding the demo catalogue first. Nothing you do in that
                 browser session can touch the store's real data.
  --no-seed      With --serve: skip the demo seed.
  --verbose      Relay Postgres' own log output.
  help           Show this text. (\`--help\` after \`--\` is eaten by \`npm run\`
                 itself and prints npm's help instead, which is why the bare word
                 exists.)

Anything else is handed to the command being run: \`vitest\` arguments in the
default mode, \`next dev\` arguments with --serve (so \`-- -p 3010\` picks a port).

  npm run test:db -- tests/order-concurrency.test.ts
  npm run dev:local -- -p 3010
`.trim();


interface Flags {
  serve: boolean;
  seed: boolean;
  verbose: boolean;
  help: boolean;
  /** Everything after `--`, passed through to `vitest`. */
  extra: string[];
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { serve: false, seed: true, verbose: false, help: false, extra: [] };
  const separator = argv.indexOf("--");

  for (const arg of separator === -1 ? argv : argv.slice(0, separator)) {
    if (arg === "--serve") flags.serve = true;
    else if (arg === "--no-seed") flags.seed = false;
    else if (arg === "--verbose") flags.verbose = true;
    else if (arg === "--help" || arg === "-h" || arg === "help") flags.help = true;
    // Anything else belongs to the thing being run, not to this script.
    //
    // `npm run` strips the literal `--` before the script ever sees it, so
    // `npm run test:db -- tests/order-concurrency.test.ts` arrives as a bare path.
    // Rejecting unrecognised arguments would therefore reject exactly the
    // invocation the README documents — and would also swallow `--reporter=…`.
    else flags.extra.push(arg);
  }

  if (separator !== -1) flags.extra = argv.slice(separator + 1);

  return flags;
}

/**
 * A port nothing is listening on.
 *
 * Asking the OS for one (`listen(0)`) rather than picking a number keeps this
 * working on a machine that already runs a Postgres on the usual 5432 — which is
 * exactly the machine an operator would be using.
 */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();

    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;

      probe.close(() => {
        if (port === 0) reject(new Error("Could not find a free port."));
        else resolvePort(port);
      });
    });
  });
}

function heading(text: string): void {
  console.log(`\n${text}`);
}

/**
 * Removes the cluster directory, retrying a few times.
 *
 * `stop()` deletes the data directory itself, and on Windows that delete loses a
 * race with the Postgres processes it has *just* stopped: the directory is still
 * locked for a moment, and the first attempt fails with `EBUSY`. The lock is
 * transient, so retrying is the whole fix. A directory that survives even this is
 * removed at the start of the next run, which is why a leftover one is reported
 * rather than thrown.
 */
async function removeClusterDirectory(): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      rmSync(DATA_DIR, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 5) {
        console.error(`  ${error instanceof Error ? error.message : error}`);
        console.error(`  Left ${DATA_DIR} in place; the next run removes it.`);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
}

/** Runs a Node CLI, inheriting stdio so its output is the user's output. */
function runCli(cli: string, args: string[], env: NodeJS.ProcessEnv): number {
  const result = spawnSync(process.execPath, [cli, ...args], {
    stdio: "inherit",
    env,
    // Windows needs the shell off here: these are real file paths, not commands.
    shell: false,
  });

  if (result.error) throw result.error;

  return result.status ?? 1;
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));

  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  if (!existsSync(PRISMA_CLI)) {
    throw new Error(`${PRISMA_CLI} is missing. Run \`npm install\` first.`);
  }

  // A fresh cluster every time. `initdb` refuses a non-empty directory, so a
  // leftover directory from an interrupted run would surface as "Postgres failed
  // to start", which points at entirely the wrong thing.
  if (existsSync(DATA_DIR)) {
    console.log(`Removing the previous cluster at ${DATA_DIR}`);
    rmSync(DATA_DIR, { recursive: true, force: true });
  }

  const port = await freePort();
  const postgres = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port,
    user: "postgres",
    password: "postgres",
    // Nothing here is meant to outlive the run.
    persistent: false,
    onLog: (message) => {
      if (flags.verbose) console.log(`  [postgres] ${message}`);
    },
    onError: (error) => {
      console.error(`  [postgres] ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/${DATABASE_NAME}`;
  // Both names. `@/lib/db` reads DATABASE_URL when it is first imported, and a
  // test file that imports it transitively would otherwise aim a pool at
  // whatever `.env` holds - the store's own database.
  const env = { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url };

  try {
    heading(`Starting Postgres on port ${port}`);
    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase(DATABASE_NAME);

    heading("Applying prisma/migrations to the empty cluster");
    const migrated = runCli(PRISMA_CLI, ["migrate", "deploy"], env);
    if (migrated !== 0) throw new Error(`prisma migrate deploy exited with ${migrated}.`);

    if (flags.serve) {
      if (flags.seed) {
        heading("Seeding the demo catalogue (this database only)");
        const seeded = runCli(resolve("node_modules/tsx/dist/cli.mjs"), ["prisma/seed.ts"], env);
        if (seeded !== 0) throw new Error(`The demo seed exited with ${seeded}.`);

        heading("Seeding the first admin account (this database only)");
        const seededAdmin = runCli(resolve("node_modules/tsx/dist/cli.mjs"), ["prisma/seed-admin.ts"], env);
        if (seededAdmin !== 0) throw new Error(`The admin seed exited with ${seededAdmin}.`);
      }

      heading("Starting next dev against the throwaway database");
      console.log(`  DATABASE_URL=${url}`);
      console.log("  Ctrl+C stops the app and the database together.\n");

      const app = spawn(process.execPath, [NEXT_CLI, "dev", ...flags.extra], {
        stdio: "inherit",
        env,
      });
      const [code] = (await once(app, "exit")) as [number | null];
      return code ?? 0;
    }

    heading("Running vitest against the throwaway database");
    return runCli(VITEST_CLI, ["run", ...flags.extra], env);
  } finally {
    heading("Stopping Postgres and deleting the cluster");
    try {
      await postgres.stop();
    } catch (error) {
      // `stop()` deletes the data directory as part of stopping, and on Windows
      // that delete can lose the race described in `removeClusterDirectory`. The
      // retry below is what actually removes it, so this is reported, not
      // rethrown: a test run that finished must not be failed by its own cleanup.
      console.error(`  ${error instanceof Error ? error.message : error}`);
    }

    await removeClusterDirectory();
  }
}

main()
  .then((code) => finish(code))
  .catch((error) => {
    console.error(`\n❌ ${error instanceof Error ? error.message : error}`);
    finish(1);
  });

/**
 * Ends the process with `code`, deliberately.
 *
 * `process.exitCode` on its own is not enough, and the reason is worth writing
 * down: `embedded-postgres` registers an `async-exit-hook`, which force-exits from
 * the `beforeExit` event with `process.exit(0)`. A naturally-ending run therefore
 * reports success no matter what happened in it — a suite with a failing test exit
 * 0, and CI passes on a broken checkout, which is exactly the failure this whole
 * script exists to stop. `process.exit` does not emit `beforeExit`, so the code
 * set here is the code the shell sees. (The hook still runs on `exit`; it is a
 * no-op by then, because `stop()` clears its process handle before returning.)
 */
function finish(code: number): void {
  process.exit(code);
}
