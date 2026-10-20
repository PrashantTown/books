# Parents Go To — backend

The API behind the Parents Go To "Reading for Pleasure" site: accounts, each family's shelf, the admin console, and the community features (message board, book reviews, resource suggestions, support messages, chat, notifications).

Built with Node.js, Express 5, MongoDB (Mongoose) and JWT sign-in tokens.

- **API reference:** [docs/API.md](docs/API.md)
- **Handover notes (what changed and why, for the team):** [docs/HANDOVER.md](docs/HANDOVER.md)

---

## Run it locally

You need Node.js 18 or newer and a MongoDB database (a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster works, or MongoDB installed locally).

```bash
npm install
cp .env.example .env        # then fill in MONGODB_URI and JWT_SECRET
npm run seed                # optional: demo accounts and sample content
npm run dev                 # API on http://localhost:5000
```

Check it's up: <http://localhost:5000/api/health>

### Demo accounts (after `npm run seed`)

| Who | Email | Password |
|---|---|---|
| Parent (Sarah, with Harry and Leo's shelf) | `demo@parentsgoto.test` | `demo1234` |
| Administrator | `admin@parentsgoto.test` | `demo1234-admin` |

Administrators also enter a six-digit code after their password: with email set up, a fresh code is emailed to them for every sign-in; without it, the shared `ADMIN_LOGIN_CODE` (if set). Change these passwords (or the `SEED_*` values in `.env`) before sharing the site with anyone.

**Email** (optional, free): with `BREVO_API_KEY` and `MAIL_FROM` set (see `.env.example`), "Forgot your password?" emails a reset link, new accounts confirm their email address, and administrators get their sign-in codes by email. To add an administrator, run the **Database tasks** workflow with `add-admin`; they then set their password with "Forgot your password?".

`npm run seed -- --reset` removes the demo accounts and adds them again fresh. The seed refuses to run when `NODE_ENV=production` unless you add `--force`.

## Connect the frontend

The frontend (the `Parents_Go_To` site) reads the API address from its `config.js`:

- On `localhost` it uses `http://localhost:5000` automatically.
- For the live site, set `DEPLOYED_API` in `config.js` to this API's public address.

Then allow the site to call the API by adding its address to `CORS_ORIGINS` in this backend's `.env`, for example `CORS_ORIGINS=https://parents-go-to.vercel.app`.

To try both together locally, serve the frontend folder with any static server, for example `npx serve -l 5500 .` or `python3 -m http.server 5500`, and open <http://localhost:5500/reading-for-pleasure.html>.

## Environment variables

All of them are described in [.env.example](.env.example). The two you must set are `MONGODB_URI` and `JWT_SECRET`; the server won't start without `JWT_SECRET`.

## Tests

```bash
npm test               # everything: 126 tests
npm run test:api       # just the API tests added for the frontend (48 tests)
npm run test:integration
```

All 126 pass, whatever the time of day or the machine's time zone. The tests use the database in `MONGODB_URI`, create their own users with unique emails, and remove them afterwards. Point it at a test database, not your live one. On GitHub, the **Database tasks** workflow runs them against Atlas (see Deploy).

The reading-hours limits are checked on the server's clock. `render.yaml` sets `TZ=Australia/Brisbane`, so a family's 7 pm limit means 7 pm in Brisbane. If families in other time zones need it later, store a time zone per family.

## Deploy

1. **Database:** create a free MongoDB Atlas cluster and a database user.
   - Allow access from anywhere (`0.0.0.0/0`), because Render's free servers have no fixed address.
   - Copy the connection string and add a database name after `.net/` (for example `.net/parentsgoto?…`).
2. **API on [Render](https://render.com):** in the dashboard, choose **New > Blueprint** and connect this repository.
   - `render.yaml` sets up the service: free plan, Singapore, health check, and `CORS_ORIGINS` for the Vercel site. Render creates `JWT_SECRET` itself, then asks you for `MONGODB_URI` and `ADMIN_LOGIN_CODE`.
   - Free servers sleep after 15 minutes without visitors and take about a minute to wake up.
3. **Demo data and tests:** add these repository secrets under **Settings > Secrets and variables > Actions**:
   - `MONGODB_URI`
   - `MONGODB_URI_TEST`: the same cluster, with database `parentsgoto_test`
   - `SEED_ADMIN_PASSWORD`: 12 or more characters
   - `SEED_PARENT_PASSWORD`

   Then run the **Database tasks** workflow from the Actions tab: `seed` once to create the accounts, and `test` to run the tests against Atlas.
4. **Frontend:** set `DEPLOYED_API` in the frontend's `config.js` to the Render address, and redeploy the site on Vercel.

Any other Node host works too: build with `npm ci`, start with `npm start`, and set the variables listed in `.env.example`.

## Project layout

```
src/
  app.js              Express app: middleware, routes, error handling (used by tests)
  server.js           Connects to MongoDB and starts listening
  config/db.js
  middleware/         auth (protect), admin, authorize, optionalAuth, rateLimit, errorHandler
  models/             Mongoose schemas
  controllers/        Request handlers, one file per area
  routes/             URL → controller wiring
  utils/              Moderation rules, platform settings, notifications, audit log, account cleanup…
scripts/seed.js       Demo data
__tests__/            Jest + Supertest suites (api-*.test.js were added with the frontend work)
docs/                 API reference and handover notes
```

### What the API covers

| Area | Base path | Notes |
|---|---|---|
| Accounts and sign-in | `/api/auth` | Sign-up (parents), sign-in with lockout, admin code, profile, password, delete account, forgot password |
| Admin | `/api/admin` | Dashboard stats, list/create/suspend/restore/delete accounts, temporary passwords |
| Family shelf | `/api/shelf` | Children, library, wishlist, reading log, activity, bedtime |
| Children | `/api/children` | Original endpoints; shelf children are stored here too |
| Settings and small per-person data | `/api/me/data`, `/api/settings/platform` | Preferences, reading interests, avatars, welcome steps; platform rules |
| Community | `/api/community/board`, `/reviews`, `/suggestions` | With moderation |
| Resources | `/api/resources` | Guides and links published by the team |
| Support | `/api/support` | Problem reports, contact form, screenshots |
| Notifications | `/api/notifications` | The bell, with per-person read state |
| Activity log | `/api/audit` | Administrators' log |
| Carers | `/api/family` | Invite, accept, withdraw |
| Chat | `/api/chat` | Parent–child profile and parent–carer conversations |
| Shared wishlists | `/api/share` | Owner manages; anyone with the link can view |
| Catalogue, parental controls, timed reading, student wishlist and reviews | `/api/books`, `/api/parental-controls`, `/api/reading-sessions`, `/api/wishlist`, `/api/reviews` | Original features, unchanged; not used by the current frontend |

## Security notes

- Public sign-up only creates **parent** accounts. Administrators are created by another administrator (`POST /api/admin/users`) or by the seed script.
- Passwords are hashed with bcrypt; sign-in tokens last 7 days and are revoked on sign-out, password change and suspension.
- Parent accounts lock after the number of wrong passwords set in the console (default 5); administrators are told. Administrator accounts don't auto-lock (so nobody can lock every admin out) but are rate-limited like everyone else.
- Community posts are checked on the server with the same rules the console sets (hold everything / hold names / hold unknown links), so the check can't be skipped from the browser.
- Rate limits are kept in memory per server process. If you run several instances, move them to a shared store such as Redis.
