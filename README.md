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

If `ADMIN_LOGIN_CODE` is set, administrators also enter that six-digit code after their password. Change these passwords (or the `SEED_*` values in `.env`) before sharing the site with anyone.

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
npm test               # everything
npm run test:api       # just the API tests added for the frontend (48 tests)
npm run test:integration
```

The tests use the database in `MONGODB_URI`, creating their own users with unique emails and removing them afterwards. Point it at a test database, not your live one.

**Known failures in the original suites (not caused by the integration):**

| Test | Why it fails | Fix to choose |
|---|---|---|
| `core-features` › "enforces parent child ownership" | Expects 403 for another family's child; the controller answers 404 | Change the test to 404 (hides whether the child exists), or the controller to 403 |
| `core-features` › "review lifecycle" | Expects 400 for rating 0 on an inactive book; the controller checks the book (403) before the rating | Validate the body before checking the book, or expect 403 |
| `integration` › B29 | The test logs in with a user object that has no email | Create the student with an email and password first |
| `integration` › B27, B28 | `jest.useFakeTimers()` freezes the HTTP and database timers, so the request never finishes; if it fails, later tests hang too | Mock `Date` only (`jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval'] })`) or pass the time into `isWithinAllowedHours` |
| `integration` › B15–B35 at night | Reading is only allowed 08:00–20:00 *server time*, so these pass or fail depending on the clock | Run with `TZ=UTC` in the daytime, or set the allowed hours per test |

The "allowed hours" check uses the server's own clock and time zone. On a host running in UTC, an Australian family's 7 pm limit would be checked as 7 pm UTC. Setting `TZ=Australia/Brisbane` on the host is the quick fix; storing a time zone per family is the proper one.

## Deploy

1. **Database:** create a MongoDB Atlas cluster, a database user, and allow access from your host. Copy the connection string into `MONGODB_URI`.
2. **API:** deploy this folder to a Node host such as [Render](https://render.com) (Web Service, build `npm install`, start `npm start`) or Railway. Set the environment variables there: `MONGODB_URI`, `JWT_SECRET`, `CORS_ORIGINS`, `ADMIN_LOGIN_CODE`, `TRUST_PROXY=1`, `NODE_ENV=production`.
3. **Demo data (optional):** run `npm run seed -- --force` once against the live database, then change the demo passwords.
4. **Frontend:** set `DEPLOYED_API` in the frontend's `config.js` to the API address and redeploy the site on Vercel.

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
