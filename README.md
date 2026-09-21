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
| Orders not in a batch | Not in a supplier run yet — they will not be made until they are. |

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
npm run db:seed               # admin login + sample catalogue + form fields
| `npm run db:check` | Read-only integrity audit: capacity invariants, settings, legacy rows. |

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
| `TEST_DATABASE_URL` | Activates the integration tests. Point it at a throwaway database: they delete the rows they create. **Leave it blank** (the default) and they are reported as skipped instead — never point it at the live database. |
| `PGPOOL_MAX` | Sockets per instance. Set to `1` on a serverless host. |

---

## How the code is arranged

```
src/lib/            the rules, mostly pure and unit-tested
  order-service.ts    the checkout transaction: capacity, pricing, snapshots
  order-answers.ts    reading and validating operator-defined answers (client-safe)
  order-form.ts       the field definitions, read from the database (server-only)
  instagram.ts        handle normalisation — the identity rules
  payment-state-machine.ts  the Paid/Unpaid toggle
  batches.ts          supplier runs and ETA wording
  storage.ts          where uploads go (local disk or Supabase)
  csv.ts              spreadsheet-safe export
  redaction.ts        what a role without customers.read must not see
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
npm test                      # unit tests only (integration tests skip)
TEST_DATABASE_URL=... npm test # everything, including real-database concurrency
```

Unit tests cover the pure rules: handle normalisation, answer validation and
redaction, the payment toggle, batch ETA wording, CSV escaping, storage driver
selection, pricing coercion and the permission matrix.

`tests/order-concurrency.test.ts` is the acceptance gate for the capacity work: it
runs real concurrent checkouts against Postgres and asserts that stock is never
oversold. It is skipped (not failed) when `TEST_DATABASE_URL` is unset.

---

## Docs

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deploy steps, the serverless
  connection trap, storage drivers, and the post-deploy smoke test.

npm run dev
```

Seed admin: `admin@anaclothing.com` / `admin123` — **change it**.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run build` / `npm start` | Production build and serve. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm test` | Vitest. Integration tests activate when `TEST_DATABASE_URL` is set. |
| `npm run db:deploy` | Apply migrations (use on every deploy). |
| `npm run db:migrate` | Create a migration from a schema change (development only). |
| `npm run db:seed` | Idempotent seed: never overwrites an operator's edits. |
| `npm run db:check` | Read-only integrity audit: capacity invariants, settings, legacy rows. |
