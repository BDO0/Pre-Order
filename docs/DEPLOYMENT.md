# Deployment

Everything here is about the two things that actually break this app in
production: **database connections** and **file storage on a read-only
filesystem**. Both have bitten this codebase before, so the failure modes are
written down rather than discovered again.

---

## 1. Environment

Copy `.env.example` and fill it in. Required:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. |
| `AUTH_SECRET` (or `NEXTAUTH_SECRET`) | Signs the admin session JWT. A weak or shared value is a full admin compromise. Generate with `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | Absolute origin of the deployment, e.g. `https://admin.example.com`. |
| `APP_URL` | **Must equal the deployed origin.** See §5. |

`TEST_DATABASE_URL` is only for the integration tests and must never point at
production.

---

## 2. Database connections (serverless)

Supabase's direct host (`db.<ref>.supabase.co:5432`) allows only a few dozen
clients. Every serverless instance opens its own pool, so traffic alone can
exhaust it and requests start failing with *"too many clients already"*.

Use the **Supavisor pooler** on port **6543** (transaction mode) for the
application, and set `PGPOOL_MAX=1` so each instance holds a single socket and
the pooler does the multiplexing:

```
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres"
PGPOOL_MAX="1"
```

Migrations must **not** run through the transaction pooler — keep the direct
string for them:

```
DIRECT_URL="postgresql://postgres.<ref>:<password>@db.<ref>.supabase.co:5432/postgres"
```

Deploy sequence:

```bash
DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
npm run db:seed          # optional; seeds are idempotent and never overwrite edits
npm run db:check         # read-only audit; exits non-zero when an invariant breaks
```

---

## 3. Keeping a free-tier project awake

Supabase pauses a free project after roughly seven idle days. The app already
exposes a probe that also touches the database:

```
GET /api/health   →  200 {"status":"ok","database":"up","latencyMs":n}
                  →  503 when the database is unreachable
```

Point any scheduler at it every few days. Pick one:

* **Vercel Cron** — `vercel.json`:
  ```json
  { "crons": [{ "path": "/api/health", "schedule": "0 6 */2 * *" }] }
  ```
* **UptimeRobot / Better Stack** — an HTTP monitor on `/api/health`, which also
  buys real downtime alerting.
* **GitHub Actions** (only if the repo is on GitHub):
  ```yaml
  on:
    schedule: [{ cron: "0 6 */2 * *" }]
  jobs:
    ping:
      runs-on: ubuntu-latest
      steps:
        - run: curl -fsS "${{ vars.APP_URL }}/api/health"
  ```

A ping is a mitigation, not a guarantee: a paid plan (no pausing) is the only
version that cannot be defeated by a scheduler outage. No workflow file is
committed here on purpose — the host decides which mechanism is available.

---

## 4. File storage

Two very different things are uploaded:

| Purpose | Location | Reachable by |
| --- | --- | --- |
| `PRODUCT_IMAGE`, `CAMPAIGN_IMAGE` | `public/uploads/` | anyone (storefront imagery) |
| `PAYMENT_PROOF` | `PRIVATE_UPLOAD_DIR` (default `private/uploads/proofs/`) | signed-in admins holding `orders.read`, via `/api/admin/proofs/<key>` |

Payment proofs are screenshots of a customer's banking app, so they are
deliberately **not** world-readable.

**On Vercel (or any read-only filesystem) local disk writes fail.** The upload
route detects `EROFS`/`EACCES`/`EPERM` and answers:

```json
{ "success": false, "error": { "code": "STORAGE_UNAVAILABLE",
  "message": "This deployment cannot store files on local disk. Configure object storage (see docs/DEPLOYMENT.md)." } }
```

That is a deliberate, explicit 503 rather than a vague failure. Until an object
storage provider is wired up, a serverless deployment cannot accept payment
proofs or product imagery — deploy to a host with a persistent volume (a
container, a VPS, Railway/Fly with a disk) or add the Supabase Storage provider
whose variables `.env.example` already reserves.

`PRIVATE_UPLOAD_DIR` must sit outside the web root and must not be a directory
the static file handler serves.

---

## 5. The `APP_URL` trap

`/preorder/[slug]` renders by fetching **its own API over HTTP**:

```ts
fetch(`${process.env.APP_URL}/api/campaigns/${slug}`)
```

If `APP_URL` does not match the origin the app is actually served from, every
campaign page returns 404 while the API works perfectly in a browser. This was
reproduced during development by running the app on port 3100 with `APP_URL`
still pointing at 3000. Set it to the real origin, including any custom domain
and the `https://` scheme.

---

## 6. Pre-launch checklist

The seed ships **working defaults that are not secrets** — they must be changed
before real customers arrive:

- [ ] **Rotate the seeded admin password.** `admin@anaclothing.com` / `admin123`.
- [ ] **Replace the placeholder payment details.** GCash/Maya still carry
      `09XXXXXXXXX`. `npm run db:check` lists any that remain.
- [ ] **Set the delivery fee** in Admin → Settings (default ₱150) and confirm the
      cart total matches the amount charged at checkout.
- [ ] **Give each staff member their own admin account and the least role they
      need.** The matrix is `src/lib/permissions.ts`: `VIEWER` cannot write,
      `ORDER_MANAGER` cannot touch the catalogue, and `PRODUCT_MANAGER` never
      receives customer contact details.
- [ ] **Set a strong `AUTH_SECRET`** and confirm the session cookie is `Secure`
      behind TLS.
- [ ] **Confirm the security headers are live**:
      `curl -sI https://<origin>/ | findstr /I "content-security-policy x-frame-options"`.
- [ ] Run `npm run db:check` and confirm *All invariants hold*.

---

## 7. Post-deploy smoke test

1. `GET /api/health` → `200`, `database: "up"`.
2. `GET /api/settings/public` → the delivery fee you configured.
3. Sign in at `/admin/login`; the sidebar shows only what the role allows, and
   the role badge under your name matches.
4. Open a **closed** campaign in the storefront → it renders as closed, and its
   stored status in the admin panel is unchanged (reads never write).
5. Place one real order end to end, then in the admin panel: open the order, view
   the proof, verify the payment, and add an internal note. The Activity Log
   should show `payment verified` and `order notes updated`, each with your email.
