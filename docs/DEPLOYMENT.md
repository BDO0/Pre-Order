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
| `AUTH_SECRET` | Signs the admin session JWT. A weak or shared value is a full admin compromise. Generate with `openssl rand -base64 32`. |
| `AUTH_URL` | Canonical origin, e.g. `https://admin.example.com`. This is also the switch that makes Auth.js trust the Host header: without `AUTH_URL`, `AUTH_TRUST_HOST`, `VERCEL` or `CF_PAGES`, a **production** build answers every `/api/auth/*` request with `UntrustedHost` (HTTP 500). Because the proxy converts auth failures into a redirect to the login page, that misconfiguration presents as "every password is rejected" rather than as a config error. |
| `APP_URL` | **Must equal the deployed origin.** See §5. |

`NEXTAUTH_SECRET` / `NEXTAUTH_URL` are the Auth.js v4 names. `next-auth` still
reads both — the secret as a fallback for `AUTH_SECRET`, and the URL only as a
fallback for building absolute URLs (`next-auth/lib/env.js`, `@auth/core`). The
URL is **not** consulted for the host-trust decision, so setting it is not a
substitute for `AUTH_URL`. `AUTH_SECRET` and `AUTH_URL` are the names to set.

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
npm run db:seed          # creates the first admin if there is none; prints its password once
npm run db:check         # read-only audit; exits non-zero when an invariant breaks
```

`db:seed` creates **one admin account and nothing else**, and never touches an
account that already exists — so it is safe to run on every deploy, and it cannot
reset a password you have changed. The demo shop (fake products, a live drop) is
`npm run db:seed:demo`, which refuses to run against anything but localhost:
never point it at production, because those products are real, orderable stock.

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

Only **storefront imagery** is uploaded: product and batch photographs. Nothing
private is ever written — payment proofs no longer exist, because payment happens
in Instagram DM and the app only records a Paid/Unpaid switch.

Where those images go is a driver, chosen by an environment variable:

| `STORAGE_PROVIDER` | Driver | Result |
| --- | --- | --- |
| unset, and Supabase unset | `local` | `public/uploads/<random>.webp`, served statically |
| unset, and Supabase set | `supabase` | Uploaded to Supabase Storage; URL returned |
| `local` | `local` | Forces local disk even if Supabase is configured |
| `supabase` | `supabase` | Forces object storage; fails loudly if half-configured |

Local disk is the default because a VPS, a container with a volume, or a
developer's laptop all work perfectly and need no account anywhere. **On Vercel
(or any read-only filesystem) local writes fail**, and the upload route detects
`EROFS`/`EACCES`/`EPERM` and answers:

```json
{ "success": false, "error": { "code": "STORAGE_UNAVAILABLE",
  "message": "This deployment cannot store files on local disk. Set STORAGE_PROVIDER=supabase with SUPABASE_URL and SUPABASE_SERVICE_KEY (see docs/DEPLOYMENT.md)." } }
```

That is a deliberate, explicit 503 rather than a vague failure — the operator is
told exactly what to do about it.

### Using Supabase Storage on Vercel

1. In the Supabase dashboard, create **two public buckets**: `products` and
   `batches` (or set `STORAGE_BUCKET_PRODUCTS` / `STORAGE_BUCKET_BATCHES` to
   the names you prefer).
2. Set `SUPABASE_URL` to the project URL and `SUPABASE_SERVICE_KEY` to the
   **service-role** key. The key is server-only; never give it a `NEXT_PUBLIC_`
   prefix and never expose it in a client component.
3. Set `STORAGE_PROVIDER=supabase` to state the intent explicitly. It is picked
   automatically once the credentials exist, but being explicit means a missing
   variable fails loudly instead of quietly falling back to a read-only disk.
4. `GET /api/health` now reports which driver is live:

   ```json
   { "status": "ok", "database": "up",
     "storage": { "driver": "supabase", "configured": true,
                  "detail": "Supabase Storage at https://… (buckets: products, batches)" } }
   ```

Buckets must be **public**: storefront imagery is served by plain URL, and a
private bucket would need a signed URL per read. Nothing sensitive is uploaded,
so public is the correct choice here.

Uploads are always re-encoded to WebP with `sharp` before storage, whatever the
driver: that destroys embedded markup (a valid image can also be valid HTML, which
would be stored XSS served from your own origin) and strips EXIF.


---

## 5. The `APP_URL` trap

`/preorder/[slug]` reads the batch (or product) **straight from the database** —
it is a server component, so there is no self-request to get wrong. `APP_URL` is
there for the absolute URLs that leave the app: the Open Graph card of a shared
pre-order link, `robots.txt`, and the sitemap.

```env
APP_URL="https://your-real-domain"
```

If it is wrong, nothing 404s — but every shared link unfurls with a broken image
or the wrong host, because an Open Graph image must be an absolute URL. On Vercel
the deployment hostname is used when `APP_URL` is unset; set it explicitly so a
link the operator pastes into an Instagram DM previews correctly.

---

## 6. Pre-launch checklist

The setup script creates **one working account and no secrets**: it generates a
password, prints it once, and stores only a bcrypt hash. There is nothing to
rotate — but there is a short list to work through before real customers arrive:

- [ ] **Make sure you can sign in at `/admin/login`**, and that the account is
      yours rather than one somebody else created. If the password is lost, any
      environment with `DATABASE_URL` can set a new one:
      `npm run admin:create -- --email you@example.com --reset-password`
      (it prints the new password once, and never asks for the old one).
- [ ] **Replace the placeholder contact details** in the storefront copy: the
      app's `NEXT_PUBLIC_INSTAGRAM_HANDLE` must be the account customers actually
      message (`@ana.clothing` is the placeholder).
- [ ] **Review the checkout questions** in Admin → Settings → Pre-Order Form.
      Nothing is defined out of the box — the form asks only for name and
      Instagram handle until you add something. Delete or hide anything you do
      not want to ask, and mark anything personal (phone, address) as *sensitive*
      so it stays hidden from staff roles that do not hold `customers.read`.
- [ ] **Give each staff member their own admin account and the least role they
      need**, one command each. The matrix is `src/lib/permissions.ts`: `VIEWER`
      cannot write, `ORDER_MANAGER` cannot touch the catalogue, and
      `PRODUCT_MANAGER` never receives customer contact details.
      ```bash
      npm run admin:create -- --email ana@example.com --name Ana --role ORDER_MANAGER
      ```
      A password passed on the command line lands in your shell history — use
      `ADMIN_PASSWORD="…" npm run admin:create -- --email …` instead, or let it
      generate one (`--reset-password` for an account that already exists).
- [ ] **Set a strong `AUTH_SECRET`** and confirm the session cookie is `Secure`
      behind TLS.
- [ ] **Confirm storage works from the deployed host**: upload one product image
      and check that the returned URL loads. On Vercel this means
      `STORAGE_PROVIDER=supabase` (§4).
- [ ] **Set `APP_URL` to the real domain** and confirm a pre-order link unfurls
      with its Open Graph card (paste it into any chat that renders previews).
- [ ] **Confirm the security headers are live**:
      `curl -sI https://<origin>/ | findstr /I "content-security-policy x-frame-options"`.
- [ ] Run `npm run db:check` and confirm *All invariants hold*.

---

## 7. Recording an order that arrived by DM

There is no "create order" button in the admin panel, and that is deliberate: the
order service is the only thing allowed to claim capacity, so an order created by
hand would be an order no stock check ever saw. The supported procedure is to
place the order **as the customer**, through the storefront:

1. Open the product's page (`/preorder/<slug>`) and put the customer's pieces in
   the cart.
2. At checkout, use **their** name and **their** Instagram handle — exactly what
   they gave you in the DM. The handle is the identity here: if they have ordered
   before, the order shows up against the same customer record.
3. Place the order. The confirmation screen shows the order number and the private
   tracking link — copy that link and send it to them in the DM.
4. In Admin → Orders, confirm the batch it landed in (the storefront puts it in the
   open one; **Batches** can move it between runs), set the status, and flip
   **Payment** to Paid once the money is actually in.

Two things to expect:

- Every order placed this way claims real capacity, so the stock numbers stay
  honest. If it would oversell, the app refuses it — which is the answer you want
  before promising the customer anything.
- The customer account will look like a first-time customer (`NEW`), because the
  handle is what decides that, and the app has no way to know you were acting for
  someone. If a customer has given you a different handle than they ordered with
  last time, the app will treat them as a new person — the same limitation as the
  duplicate check, and the reason to ask for their handle before placing anything.

---

## 8. Post-deploy smoke test

1. `GET /api/health` → `200`, `database: "up"`, and a `storage` block naming the
   driver you expect.
2. `GET /api/batches` returns the batches that are open right now: a batch
   whose `endAt` has passed must not appear.
3. `GET /robots.txt` → the admin panel and `/order-status` are disallowed, and the
   sitemap line points at your domain.
4. Sign in at `/admin/login`; the sidebar shows only what the role allows, and
   the role badge under your name matches.
5. Open a **closed** batch in the storefront → it renders as closed, and its
   stored status in the admin panel is unchanged (reads never write).
6. Place one real order end to end. On the confirmation screen, open the private
   link → the order status page loads with no typing. Then in the admin panel:
   open the order, flip **Payment** to Paid, assign it to a **Batch**, and add an
   internal note. The Activity Log should show `order batched`, `payment paid`
   (*not* "verified") and `order notes updated`, each with your email.
7. Export the batch's CSV from Admin → Batches → Export and open it in a
   spreadsheet: the Instagram handles must carry a leading apostrophe (so a
   spreadsheet does not execute them as formulas) and the rows must stay aligned.

