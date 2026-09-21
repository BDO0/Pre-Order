# ANA Pre-Order System

A deliberately small pre-order app for a one-person clothing shop.

Drop a limited collection, take reservations, and settle the details over
Instagram DM — where this shop already works. The app does the part that used to
be a notebook: taking reservations without overselling, telling each customer
where their order is, and telling the operator what needs doing today.

---

## How ordering works (customer)

1. Open `/preorder/<drop>` and add pieces to the cart.
2. Checkout asks for **two things**: full name and Instagram username. Everything
   the operator decided to ask on top of that (phone, address, notes…) appears
   underneath, and the operator can change those questions without a deploy.
3. The order is placed. **No payment is taken on the site.**
4. The confirmation screen shows the order number and a private link that opens
   the order status page. That link contains an unguessable token; it is the
   customer's way back in. If they lose it, `/order-status` accepts their order
   number *plus* the Instagram username they ordered with.

There is no account, no password, no email verification and no payment step.

## How the day works (operator)

Login at `/admin/login`. The dashboard opens with **what needs attention**, not a
wall of charts:

| Action item | What it means |
| --- | --- |
| Orders awaiting your approval | New reservations nobody has looked at. |
| First-time customers who have not paid | These usually need a DM. |
| Unpaid orders | Everything still waiting for money. |

Every item links to the exact filtered order list that resolves it, and that list
exports to CSV. There are **no notifications** in this system — see below.

The rest is three screens: **Orders** (one queue, every order, with an `OG`/`NEW`
badge and a Paid/Unpaid switch), **Batches** (supplier runs and their ETA), and
**Settings** (the checkout questions).

---

## The decisions this app is built on

Each of these removed something a generic order system would have. They are
listed because a future change that quietly re-adds one would undo the point.

**Payment is a switch, not a workflow.** Customers pay over DM. The only fact the
system can honestly hold is whether the operator has confirmed the money arrived,
so `paymentStatus` is `UNPAID`/`PAID` and the admin flips it. There is no proof
upload, no review queue, no `PENDING_REVIEW`, and no payment-method catalogue,
because all of that was machinery around a decision that happens in a chat window.

**The Instagram handle is the identity.** It keys the customer record, the
duplicate check and the trust badge. It is stored normalised (lowercase, no `@`,
pasted profile URLs accepted) so `@JuanDC` and `juandc` are one person — which is
what makes two customers called "Juan dela Cruz" distinguishable. It is also the
second factor on the public status lookup, because the order number alone is a
per-day sequence and would let anyone walk the day's orders.

**Two checkout fields are fixed; the rest are data.** Full name and Instagram
username are the skeleton. Every other question is an `OrderFormField` the
operator adds, renames, reorders, hides or soft-deletes. Answers are snapshotted
**with the label that was shown at the time**, so renaming a question never
rewrites what a customer already answered.

**Orders are unguessable, and one queue.** Every order's status page is reachable
by a 192-bit token. Order numbers are sequential, so they are treated as an
identifier, never as a secret.

**Batches are how fulfilment actually works.** Pre-orders ship in waves: collect,
place one supplier order, receive parcels together. A `Batch` is that wave with an
ETA, and "not in a batch" is a dashboard action item rather than a silent gap.

**Why there are no notifications.** There is no email, SMS or push. The operator
works a single queue, and the dashboard action list is what surfaces work — so
notifications would be a second, worse copy of a list that already exists, plus a
deliverability problem and an account to maintain. `notification-service.ts` was
deleted rather than left as a console no-op that pretended to notify someone.

**Storefront imagery is public, and storage is a driver.** Product and batch
images are served by URL; nothing private is ever uploaded (there are no payment
proofs to protect any more). Where they are written is configuration: local disk
by default, Supabase Storage for a serverless host. See
[docs/DEPLOYMENT.md §4](docs/DEPLOYMENT.md).

---

## Getting started

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL and AUTH_SECRET
npm run db:deploy             # apply migrations
npm run db:seed               # create the first admin; prints its password once
npm run db:seed:demo          # optional: fake products and a local-only drop
npm run dev                   # then open http://localhost:3000
```

`db:seed` creates **one admin account and nothing else**. The password is
generated and printed once, or taken from `ADMIN_PASSWORD` if you set it (which
also keeps it out of your shell history). Re-running it never touches an existing
account, so it cannot lock you out and cannot reset a password you have changed:

```bash
npm run admin:create -- --email ana@example.com --role ORDER_MANAGER
npm run admin:create -- --email ana@example.com --reset-password  # new password, printed once
npm run admin:create -- --email ana@example.com --password "correct horse battery"  # or pick it
npm run admin:create                                              # prints its own help
```

`db:seed:demo` is the fake shop (three products, a live "September Drop 2026"
batch). It exists for a laptop, so it refuses to run unless `DATABASE_URL` points
at localhost — set `ALLOW_DEMO_SEED_REMOTE=1` for a throwaway database that is not
local, and never for the live one: those products are real, orderable stock.

`npm run dev:local` is the safe way to click around: it starts a throwaway
Postgres in `node_modules/.cache`, applies the migrations, seeds that demo shop
into *it*, and runs `next dev` against it. The running app cannot reach the real
data, and Ctrl+C stops the app and deletes the database together.

---

## Environment

Only two variables are required to run locally: `DATABASE_URL` and
`AUTH_SECRET` (`openssl rand -base64 32`). `.env.example` documents the rest.

The ones that change behaviour:

| Variable | Why it matters |
| --- | --- |
| `APP_URL` | Absolute URLs for metadata, Open Graph cards, `robots.txt` and the sitemap. On Vercel the deployment host is used automatically; set it to the real domain so shared links unfurl properly. |
| `NEXT_PUBLIC_INSTAGRAM_HANDLE` | The account customers are told to message. The most important trust copy on the site. |
| `STORAGE_PROVIDER`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Where product/batch imagery is written. Local disk by default; Supabase Storage on a serverless host. |
| `TEST_DATABASE_URL` | Activates the integration tests. Usually you leave it blank and run `npm run test:db`, which starts a throwaway database and sets this for that run. Only set it by hand to point at a database you are willing to lose: the tests delete the rows they create. |
| `PGPOOL_MAX` | Sockets per instance. Set to `1` on a serverless host. |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_ROLE`, `ADMIN_PASSWORD` | Read by the setup scripts only (`db:seed`, `admin:create`), never by the running app. |
| `ALLOW_DEMO_SEED_REMOTE` | `1` lets `db:seed:demo` write demo data into a database that is not localhost. |

---

## How the code is arranged

```
src/lib/            the rules, mostly pure and unit-tested
  order-service.ts    the checkout transaction: capacity, pricing, snapshots
  order-answers.ts    reading and validating operator-defined answers (client-safe)
  form-field-admin.ts the checkout questions: which options a field may have
  instagram.ts        handle normalisation — the identity rules
  payment-state-machine.ts  the Paid/Unpaid toggle
  batches.ts          supplier runs and ETA wording
  storage.ts          where uploads go (local disk or Supabase)
  csv.ts              spreadsheet-safe export
  redaction.ts        what a role without customers.read must not see
  admin-password.ts   the one password policy (endpoint, seed and admin:create)
  prisma-errors.ts    reading a unique-constraint violation out of P2002/23505
  variant-stock.ts    "how much is left?" for the admin tables
src/app/api/        every admin route re-checks the permission server-side
src/app/admin/      the operator's screens
src/app/preorder/   the storefront
```

### Two rules worth knowing before changing anything

**Never trust the browser with money or stock.** The order service recomputes
prices and claims capacity with conditional `UPDATE`s inside one transaction, so
two simultaneous checkouts cannot both take the last unit. `remainingCapacity`
and `preorderReserved` are the source of truth, and cancelling an order returns
its capacity in the same transaction as the status change.

**Hide nothing in the client.** Every admin route calls `requirePermission`, and
the order payload is redacted server-side — the UI only renders the flags the API
sends it. A role without `customers.read` receives the Instagram handle as
`[hidden for your role]` and sensitive answers stripped, which is why the API
computes that redaction rather than the screen.

---

## Testing

```bash
npm test          # unit tests; the integration tests report themselves as skipped
npm run test:db   # everything, including real-database concurrency
```

`npm run test:db` needs nothing installed and nothing configured. It boots a
private Postgres out of the `embedded-postgres` package on a free port, applies
`prisma/migrations` to that empty cluster, runs the suite with both `DATABASE_URL`
and `TEST_DATABASE_URL` aimed at it, and deletes the cluster afterwards — including
when the tests fail. The whole test process is re-pointed before any test runs, so
it cannot reach the store's own database even by accident. Arguments after `--` go
to Vitest:

```bash
npm run test:db -- tests/order-concurrency.test.ts
```

On Windows the delete at the end can need a second attempt or two, because the
directory stays locked for a moment after Postgres exits; the script retries, and
anything that survives is removed at the start of the next run. Only
`node_modules/.cache` is ever involved — no service is registered and nothing is
installed system-wide.

Unit tests cover the pure rules: handle normalisation, answer validation and
redaction, the shape of the checkout-answer payload the form sends
(`tests/checkout-answers.test.ts`), the payment toggle, batch ETA wording, CSV
escaping, storage driver selection, pricing coercion, the product variant rules
the two product screens share (`tests/variant-plan.test.ts`), the stock summary
the admin tables show (`tests/variant-stock.test.ts`), and the permission matrix.

`tests/order-concurrency.test.ts` is the acceptance gate for the capacity work: it
runs real concurrent checkouts against Postgres and asserts that stock is never
oversold. It is skipped (not failed) when `TEST_DATABASE_URL` is unset, which is
why `npm test` alone is not evidence that checkout still works. CI runs
`typecheck`, `lint`, `npm test` and then `npm run test:db` on every push, so those
tests are a gate rather than a thing somebody remembers to run.

---

## Docs

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deploy steps, the serverless
  connection trap, storage drivers, and the post-deploy smoke test.
- [docs/OPERATOR-GUIDE.md](docs/OPERATOR-GUIDE.md) — the same app from the
  operator's side: the daily routine, in plain words, with no code in it.

---

## Commands

Every `db:*` command needs `DATABASE_URL` set; they are the only ones that talk
to Postgres directly.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on <http://localhost:3000>. |
| `npm run build` / `npm start` | Production build and serve. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm test` | Vitest. Integration tests activate when `TEST_DATABASE_URL` is set — use `npm run test:db` for those. |
| `npm run test:db` | The whole suite against a throwaway Postgres it starts, migrates and deletes. |
| `npm run dev:local` | `next dev` against that same throwaway database, with the demo shop seeded into it. |
| `npm run db:deploy` | Apply migrations (use on every deploy). |
| `npm run db:migrate` | Create a migration from a schema change (development only). |
| `npm run db:seed` | Create the first admin account. Idempotent: it never resets a password. |
| `npm run db:seed:demo` | Demo shop (fake products, a live drop). Refuses to run against a non-local database. |
| `npm run admin:create` | Add a colleague, change a role, or reset a password. `--help` for the flags. |
| `npm run db:check` | Read-only integrity audit: capacity invariants, settings, legacy rows. |
| `npm run db:studio` | Prisma Studio, to look at the rows directly. |

One script is run directly rather than through an npm alias, because it is a
one-off repair rather than a routine command:

```bash
npx tsx scripts/attach-orphan-products.ts   # link products that lost their batch
```
