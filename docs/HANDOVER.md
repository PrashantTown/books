# Handover: connecting the frontend to the backend

**Backend:** `main` in [`PrashantTown/books`](https://github.com/PrashantTown/books), built on top of `cbb5ecf "finished"`. Live at <https://parents-go-to-api.onrender.com> (Render, with MongoDB Atlas).
**Frontend:** `main` in [`PrashantTown/Parents-Go-To`](https://github.com/PrashantTown/Parents-Go-To): the team's final version of the site, connected to this API. Live at <https://parents-go-to-live.vercel.app>. Its `BACKEND.md` covers the frontend side.

## In short

Before this work, the site kept everything in the browser's localStorage: accounts, each family's shelf, board posts and the admin console. As a result:

- nothing was shared between devices or between people;
- an administrator never saw what parents posted;
- anyone could sign in with the demo password.

Now accounts and data are stored in MongoDB, behind this API. The frontend still reads and writes localStorage as before. A new layer underneath it, `sync.js`, sends changes to the API and refreshes from it, so most of the frontend's code didn't have to change.

## How it's deployed

1. **Database:** a MongoDB Atlas cluster (Cluster0, AWS Sydney) with access from anywhere (`0.0.0.0/0`), because Render's free servers have no fixed address.
2. **API:** a Render Blueprint from this repository; Render redeploys on every push to `main`. `render.yaml` sets:
   - `JWT_SECRET` (Render generates it), `NODE_ENV=production`, `TRUST_PROXY=1`, `TZ=Australia/Brisbane`;
   - `CORS_ORIGINS`: the Vercel sites allowed to call the API;
   - `MAIL_FROM_NAME=Parents Go To`.

   `MONGODB_URI` and `ADMIN_LOGIN_CODE` are entered in Render's dashboard, never in the repository.
3. **Email:** add `BREVO_API_KEY` and `MAIL_FROM` (a sender verified in Brevo) under **Environment** on Render. Until both are there, every email feature is off and the site works as before (shared `ADMIN_LOGIN_CODE`, resets through the administrators). `https://parents-go-to-api.onrender.com/api/health` shows `"email": true` once it's on.
4. **Administrators and demo data:** public sign-up only creates parents.
   - The **Database tasks** workflow (Actions tab) has `seed` (demo accounts and content), `catalogue` (adds any starter books missing from "Discover books", leaving the rest alone), `add-admin` (a new administrator, or `promote` to make an existing parent account one) and `test`.
   - It uses the repository secrets `MONGODB_URI`, `MONGODB_URI_TEST`, `SEED_ADMIN_PASSWORD` (12 or more characters) and `SEED_PARENT_PASSWORD`. The repository is public, so the workflow refuses to fall back to the demo passwords.
   - Once email is on, an administrator adds others from the console (**Accounts > Add an administrator**).
5. **Frontend:** Vercel redeploys `PrashantTown/Parents-Go-To` on every push to `main`. Its `config.js` points at this API.

## What changed in this repository

**New**
- `src/app.js` builds the Express app. `server.js` now only loads `.env`, connects to the database and starts listening, which lets the tests use the app without a server.
- 20 models, 15 controllers, 13 route files, 3 middleware files (`errorHandler`, `optionalAuth`, `rateLimit`) and 12 helpers in `src/utils` (including `mailer.js` for email).
- `scripts/seed.js` for demo accounts, sample content and the starter book catalogue; `scripts/add-admin.js` for adding an administrator.
- Seven `__tests__/api-*.test.js` suites (77 tests) with a shared helper, plus `jest.setup.js`.
- `render.yaml`, the **Database tasks** workflow, `.env.example`, `README.md`, and these docs.

**Changed** (please review these, because they touch existing code):

| File | Change |
|---|---|
| `src/controllers/authController.js` | Sign-up is parent-only (see the security fix below) and, with email on, confirms the email address. Sign-in now has a lockout, role checks and the administrator code step (emailed per sign-in). Adds profile, password, account deletion, sign-out, and password reset by email |
| `src/routes/auth.routes.js` | The new routes above, with rate limits |
| `src/routes/admin.routes.js` | Account management for the console: list, create, suspend or restore, delete, add an administrator by email |
| `src/routes/health.routes.js` | Also says whether email is set up |
| `src/models/User.js` | Adds `failedLogins`, `lockedOut`, `tempPassword`, `passwordChangedAt`, `tokenVersion`, and hashes for reset links, confirmation links and emailed sign-in codes |
| `src/models/Child.js` | `age` is now optional in the schema, because shelf children can leave it blank. `POST /api/children` still requires it. Adds `clientId` (the frontend's id, unique per parent) and `position` |
| `src/server.js` | The app moved to `app.js`. The server refuses to start without `JWT_SECRET` |
| `package.json` | Adds `seed` and `test:api` scripts. Fixes `test:integration` (Jest 30 renamed `--testPathPattern`), and `main` now points at the real entry file |
| `jest.config.js` | Loads `jest.setup.js` |

Every other original endpoint behaves exactly as before.

## Where the data lives

| Collection | Holds |
|---|---|
| `users` (existing) | All accounts. New fields for lockout and temporary passwords |
| `children` (existing) | Children from the original API **and** from the family shelf. Shelf children don't get a student login; `POST /api/children` still creates one |
| `shelfbooks` | Library and wishlist books (`list: "library" \| "wishlist"`) |
| `readinglogs` | The family reading log |
| `familyprofiles` | Shelf colour, recent activity, bedtime settings |
| `userdatas` | Small per-person documents: settings, reading interests, avatar choices, welcome steps |
| `boardposts`, `bookreviews`, `suggestions` | Community content and its moderation state |
| `resources` | Guides published from the console |
| `supporttickets`, `supportscreenshots`, `counters` | Problem reports and contact messages, their screenshots, and the `PTG-1001` reference numbers |
| `notifications` | The bell. Read and dismissed state is kept per person |
| `auditlogs` | The console's activity log |
| `carerinvites` | Sharing a shelf with another adult |
| `chatthreads`, `chatmessages`, `chatreads` | Family and carer chat |
| `sharelinks` | Public wishlist links |
| `projects` | The home page's project tiles |
| `cataloguebooks` | "Discover books": the team's recommended books, including free classics from Project Gutenberg |

`bookreviews` (parents reviewing any book) is separate from the original `reviews` (students reviewing catalogue books).

## Decisions worth knowing

- **The frontend's ids are kept.** Records the frontend creates (`"b1"`, `"bd-x7k2m9p0"`) are stored with that id as `clientId`, which is unique per owner. The API returns it as `id`, so the frontend matches records without remapping. MongoDB `_id`s stay internal.
- **The server decides.** It checks moderation, ownership and who may see what, so these can't be skipped by editing localStorage. If the server refuses a change, the frontend's copy is put back on the next refresh.
- **Moderation runs on the server, using the console's rules.**
  - By default everything is held for review.
  - With "hold everything" off, the console's other two rules decide: whether to hold posts that seem to name a person, and whether to hold links outside trusted sites. Both are on by default.
  - Board posts and reviews that pass are stored as `published`. The original frontend set them to `approved` while its pages only showed `published`, so automatically approved posts never appeared.
- **Platform settings.** The console's settings (moderation, lockout attempts, retention) are saved as part of the administrator's settings. For each one, the value most recently saved by any administrator applies. Anyone signed in can read them from `GET /api/settings/platform`.
- **Lockout.**
  - The server counts wrong passwords. When the count reaches the console's limit (5 by default), the account is locked and the administrators are notified. An administrator unlocks it from the console by restoring the account; resetting the password from an emailed link also unlocks it.
  - Administrator accounts don't lock, so nobody can lock every admin out. They are rate-limited like everyone else.
- **Administrator code.** The six-digit step after an admin's password is checked on the server. With email set up, every sign-in emails a fresh code to that administrator's own address (it works once, for 10 minutes; only a hash is stored). Without email, everyone uses the shared `ADMIN_LOGIN_CODE`; leave it empty to switch the step off.
- **Sign-out really signs out.** Tokens are revoked on sign-out, password change and suspension (`tokenVersion` on the user).
- **Forgot password.** With email set up (Brevo, see `.env.example`), the person gets a one-time link that lasts 30 minutes; only a hash of it is stored, and using it signs out their other sessions. With email on, administrators never set passwords for people, so the console's "Temporary password" button disappears. It only shows while email isn't set up, as the fallback: the administrators are told about the request, give the person a temporary password, and signing in with it goes straight to "Choose a new password".
- **Confirming new accounts.** With email set up, a new account can't sign in until its owner opens the confirmation link we email them (24 hours; they can ask for another). Opening it signs them in.
- **Who gets the emails from the site.** Contact-page messages, problem reports and "Keep me posted" sign-ups go to `SUPPORT_EMAIL` (one or more addresses) or, if that's empty, to every active administrator. Replying to the email answers the person who wrote in. Everything also stays in the console's support inbox.
- **Carer invitations** are emailed to the person invited, with a link to create an account (or sign in) and accept. They also appear in the app if that person already has an account.
- **Adding administrators.** The console's **Add an administrator** emails the new administrator a one-time link (48 hours) to choose their own password; nobody else ever knows it. The demo address `admin@parentsgoto.test` can't receive email, so once email is on every administrator needs a real address.
- **Changing your email** also moves your chats, carer invitations and notifications to the new address.
- **Deleting an account** removes everything that belongs to it: children and their student logins, the shelf, reading log, posts, reviews, suggestions, tickets, chats, invitations, share link and notifications. The activity log keeps its entries on purpose, so administrators still have a record. The last active administrator can't delete their own account.

## Problems found in the existing code

**Fixed**
- **Security:** `POST /api/auth/register` accepted `"role": "admin"`, so anyone could create an administrator account. Public sign-up now creates parents only; administrators are created from the console or by the seed script.
- `npm run test:integration` didn't run under Jest 30, because the flag it used had been renamed.
- In the frontend:
  - Automatically approved board posts and reviews never appeared (`approved` vs `published`, explained above).
  - A quick sign-in sometimes snapped back to the sign-in form.
  - Carers could be invited, but there was no way to accept an invitation; an invitation banner has been added.

**The original tests that were failing now all pass.** The fixes follow what the tests asked for:
- **Another family's child:** `GET`, `PUT` and `DELETE /api/children/:id` answer 403 (they answered 404), the same as the parental-controls endpoints. A child that doesn't exist is still 404.
- **Student reviews:** the rating is checked before the book, so a bad rating is always 400.
- **Students without parental controls:** they get 403 from usage, remaining time and history, not just from starting a session. `GET /api/reading-sessions/remaining-time` (no child id) now gives a student their own remaining time.
- **The tests no longer depend on the clock.**
  - B27 and B28 froze the whole clock, which stalled the database driver. They now build their reading windows around the real time.
  - The other reading tests open the window all day, and use the server's own date for today's sessions.
  - B29 now signs in a real student.

The reading-hours check uses the server's clock, so `render.yaml` sets `TZ=Australia/Brisbane`.

## How it was tested

- **API:** 48 new Jest and Supertest tests (`npm run test:api`) cover:
  - sign-up, sign-in, lockout and the admin code;
  - the console's account tools;
  - the shelf and per-person data;
  - moderation, support and notifications;
  - carers, chat, share links;
  - basics: 404s, bad JSON, security headers, CORS and rate limits.
- **Original suites:** all pass. That's 131 tests in total with `npm test` (102 when this handover began), checked in three time zones and at different times of day, and run against Atlas on GitHub.
- **In a real browser:** 32 end-to-end checks ran against the full stack (API, database and the final site) in Chromium. They covered:
  - sign-in and sign-up through the forms;
  - two devices seeing each other's changes;
  - reload and sign-out;
  - lockout messages;
  - the admin code, suspending and restoring accounts;
  - moderation of board posts, reviews and suggestions;
  - resources, support with screenshots, forgot password;
  - carer invitation and chat, share links;
  - name, password and account deletion in Settings;
  - changes made offline being sent later;
  - a session ended on another device;
  - the emails: reset links, confirming a new account, administrator codes, adding an administrator;
  - project tiles, the book catalogue, and who added each wishlist book.
- **Database:** the browser checks ran against a MongoDB-compatible stand-in; the Jest suites also run against Atlas through the **Database tasks** workflow (`test`).

## Known limits and next steps

- **Retention settings only hide old entries.** The console's "keep the activity log / decided suggestions for N days" settings filter what the console shows; the records stay in the database. If the privacy policy promises deletion, add a scheduled clean-up job or MongoDB TTL indexes. "Close dormant accounts" does take effect, but only while an administrator has the console open, because the console is what runs it.
- **Polling, not live updates.** Shared things (board, reviews, chat, notifications) refresh every 20 seconds and when the tab regains focus (`pollSeconds` in `config.js`). Chat isn't instant. WebSockets or server-sent events would be the upgrade.
- **Screenshots** for problem reports are stored in MongoDB, up to 2 MB each. Move them to object storage (S3, Cloudinary) if there will be many.
- **Email limits.** Brevo's free plan sends up to 300 emails a day. Sending from a Gmail address without your own domain works, but some emails may land in spam; a domain of your own, verified in Brevo, fixes that.
- **Rate limits** are kept in memory, so they reset when the server restarts and aren't shared between instances. Use Redis if you run more than one.
- **Original features not used by the frontend yet:** the catalogue (`/api/books`), parental controls, timed reading sessions, and students' wishlist and reviews.
