# Velokas Woodworks · Κοστολόγηση Κουζίνας

A phone-first kitchen cost calculator for Velokas Woodworks, built from Panos's mockup. It runs entirely on Cloudflare's free tier: a Worker serves the app and a small API, and a D1 (SQLite) database stores the prices.

<p>
  <img src="docs/screenshots/calculator.jpg" width="200" alt="Calculator">
  <img src="docs/screenshots/extras.jpg" width="200" alt="Extras with steppers">
  <img src="docs/screenshots/quote.jpg" width="200" alt="Quote sheet">
  <img src="docs/screenshots/settings-dark.jpg" width="200" alt="Settings in dark mode">
</p>

## What it does

**Κοστολόγηση (calculator tab)** — open to anyone with the link:

1. **Βασική κουζίνα:** pick the material and type the metres. The price per metre comes from Settings and can be changed for a single quote.
2. **Extras:** each item has a quantity stepper and a unit price that can also be changed per quote, plus an «Άλλο extra» amount.
3. **Εσωτερική κοστολόγηση (optional):** Panos's own costs (parts, doors, hardware, countertop, labour, transport) show the profit and margin. These are never included in the quote he sends.

The total updates live in the bar at the bottom. **Προσφορά** opens a breakdown with VAT, and **Αποστολή / Αντιγραφή** shares the quote as text (Viber, Messenger, email). Whatever is typed is kept on the phone, so a refresh doesn't lose it. If the network drops, the app falls back to the last prices it loaded.

**Ρυθμίσεις (settings tab)** — password protected:

- Business name, subtitle, VAT rate
- Materials (price per metre), extras (price per piece and icon) and internal cost lines
- Add, rename, reprice, hide or show, reorder and delete, then press **Αποθήκευση**

Calculation, all amounts excluding VAT:

```
base   = metres × price per metre
extras = Σ quantity × unit price  +  other extra
total  = base + extras            (VAT is shown on top of this)
profit = total − internal costs   (margin = profit ÷ total)
```

The database starts with the values from the mockup. Only «Μελαμίνη — 320 €» was visible in the material dropdown, so add the other finishes in **Ρυθμίσεις**.

## Deploy

Every push to `main` runs the tests and deploys through GitHub Actions (`.github/workflows/deploy.yml`). Setup takes a phone browser and a free Cloudflare account; no computer is needed.

1. **Cloudflare account.** Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) and open **Workers & Pages** once. If it asks for a `workers.dev` subdomain, pick one; it becomes part of the app's address.
2. **Account ID.** Copy it from the **Account details** box on the Workers & Pages page. It's also the long code in the address bar right after `dash.cloudflare.com/`.
3. **API token.** Go to [My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → **Edit Cloudflare Workers** → **Use template**.
   - Under Permissions, choose **+ Add more** and add **Account · D1 · Edit**.
   - Set Account Resources to your account and Zone Resources to **All zones**.
   - Choose **Continue to summary** → **Create Token** and copy the token.
4. **GitHub secrets.** Add three repository secrets at [Settings → Secrets and variables → Actions](https://github.com/NinjaStore3/VelokasWoodWorks/settings/secrets/actions/new). On a phone, use the browser rather than the GitHub app.

   | Name | Value |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | the token from step 3 |
   | `CLOUDFLARE_ACCOUNT_ID` | the ID from step 2 |
   | `ADMIN_PASSWORD` | the password for the Settings tab; use a long one |

5. **Run it.** Open **Actions → Test and deploy → Run workflow**, or push to `main`.
   - The first run creates the `velokas-db` database, deploys the app and fills the database with the starting prices.
   - The run's summary page shows the link, `https://velokas-woodworks.<your-subdomain>.workers.dev`.

To change the Settings password later, update the `ADMIN_PASSWORD` secret and run the workflow again. That also signs every device out. For your own domain, go to Worker → Settings → Domains & Routes in Cloudflare.

On Panos's phone, open the link and choose **Add to Home screen** (Chrome menu, or Safari's Share button). It gets its own app icon and opens full screen.

### Deploying from a computer instead

With [Node.js](https://nodejs.org) 20 or newer:

```bash
npm install
npx wrangler login                     # opens the browser to authorise Wrangler
npm run deploy                         # deploys, then applies database migrations
npx wrangler secret put ADMIN_PASSWORD # first time only
```

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # set a local admin password in it
npm run db:migrate:local         # creates a local SQLite copy of the database
npm run dev                      # http://localhost:8787
```

```bash
npm test          # unit tests + API tests against a real local Worker and database
npm run test:unit # unit tests only (no Worker)
```

There is no build step. Files in `public/` are served as they are.

## Project layout

```
public/                 the app (plain HTML, CSS and JS modules)
  index.html
  css/app.css           design tokens, light and dark themes
  js/calc.js            pricing maths and Greek number formatting (pure, tested)
  js/calculator.js      calculator tab
  js/settings.js        settings tab
  js/icons.js           icon list for the picker, colour helper
  icons.svg             Lucide icon sprite (generated by `npm run icons`)
  _headers              security headers (CSP etc.) for static files
src/                    the Worker (API)
  worker.js             routing and error handling
  config.js             read and save settings in D1
  auth.js               admin login, sessions, password-guessing throttle
  validate.js           validation of saved settings (pure, tested)
migrations/             D1 schema and starting data
tests/                  node:test suites
wrangler.jsonc          Cloudflare configuration
```

### API

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/config` | public | Active materials, extras, cost lines, VAT |
| GET | `/api/admin/session` | public | Is a password configured, is this browser logged in |
| POST | `/api/admin/login` | public | `{ "password": "…" }` → session cookie |
| POST | `/api/admin/logout` | admin | End the session |
| GET | `/api/admin/config` | admin | Everything, including hidden items |
| PUT | `/api/admin/config` | admin | Replace the settings (validated, versioned) |

Prices are stored as integer cents. Saving sends the version the editor loaded; if another device saved in between, the API answers 409 instead of overwriting.

### Changing the database

Add a new numbered file such as `migrations/0002_add_quotes.sql`, try it locally with `npm run db:migrate:local`, then push to `main`. The deploy applies it after the new code goes live.

## Security

- Admin sessions use a random token in an `HttpOnly; Secure; SameSite=Strict` cookie, valid for 30 days. Only a SHA-256 hash of the token is stored.
- After 10 wrong passwords from one IP within 15 minutes, logins are refused.
- State-changing requests must be same-origin JSON. Static files get a strict Content Security Policy.
- To change the password, update the `ADMIN_PASSWORD` secret and redeploy. This signs every device out.

## Free tier

Requests for static files are free and unlimited. The free Workers plan allows 100,000 API requests per day; opening the app makes about one. D1 allows 5 million row reads and 100,000 row writes per day. This app uses a tiny fraction of either.

## Credits

Icons: [Lucide](https://lucide.dev) (ISC). Fonts: Manrope and Fraunces (SIL Open Font License, see `public/fonts/`).
