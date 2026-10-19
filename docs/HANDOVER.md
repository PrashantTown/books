# Handover: connecting the frontend to the backend

**Backend:** branch `frontend-integration`, one commit on top of `cbb5ecf "finished"`.
**Frontend:** one commit on top of `ae1a018` on `main` in `Sudarshan-2063/Parents-Go-To`, which has the same files as the zip that was sent over. The frontend folder has its own note, `BACKEND.md`, covering that side.

## In short

Before this work, the site kept everything in the browser's localStorage: accounts, each family's shelf, board posts and the admin console. As a result:

- nothing was shared between devices or between people;
- an administrator never saw what parents posted;
- anyone could sign in with the demo password.

Now accounts and data are stored in MongoDB, behind this API. The frontend still reads and writes localStorage as before. A new layer underneath it, `sync.js`, sends changes to the API and refreshes from it, so most of the frontend's code didn't have to change.

## Going live, in this order

1. **Database:** create a MongoDB Atlas cluster and a database user, allow access from anywhere (`0.0.0.0/0`), then copy the connection string.
2. **API:** on Render, choose **New > Blueprint** and connect this repository. `render.yaml` sets these environment variables:
   - `JWT_SECRET`: Render generates it
   - `CORS_ORIGINS=https://parents-go-to.vercel.app`
   - `TRUST_PROXY=1`
   - `NODE_ENV=production`

   Render then asks you for `MONGODB_URI` and `ADMIN_LOGIN_CODE`. On another host, set all six yourself.
3. **Check:** `https://<your-api>/api/health` should answer with `success: true`.
4. **Administrator account and demo data:** public sign-up only creates parents, so the seed is how the first administrator is created.
   - Add the repository secrets `MONGODB_URI`, `SEED_ADMIN_PASSWORD` (12 or more characters) and `SEED_PARENT_PASSWORD`.
   - Run the **Database tasks** workflow with `seed` from the Actions tab.
   - The repository is public, so the workflow refuses to fall back to the demo passwords.
5. **Tests against Atlas:** add `MONGODB_URI_TEST` (the same cluster, database `parentsgoto_test`) and run the workflow with `test`.
6. **Frontend:** in the site's `config.js`, set `DEPLOYED_API` to the API address, then redeploy on Vercel.

**Deploy the frontend last.** Until `DEPLOYED_API` is set, the updated site turns sign-in off. It shows a "This copy of the site isn't connected to its server yet" message instead of letting people in with the old demo password.

## What changed in this repository

**New**
- `src/app.js` builds the Express app. `server.js` now only loads `.env`, connects to the database and starts listening, which lets the tests use the app without a server.
- 18 models, 13 controllers, 11 route files, 3 middleware files (`errorHandler`, `optionalAuth`, `rateLimit`) and 8 helpers in `src/utils`.
- `scripts/seed.js` for demo accounts and sample content.
- Five `__tests__/api-*.test.js` suites (48 tests) with a shared helper, plus `jest.setup.js`.
- `.env.example`, `README.md`, and these docs.

**Changed** (please review these, because they touch existing code):

| File | Change |
|---|---|
| `src/controllers/authController.js` | Sign-up is parent-only (see the security fix below). Sign-in now has a lockout, role checks and the administrator code step. Adds profile, password, account deletion, sign-out and forgot-password handlers |
| `src/routes/auth.routes.js` | The new routes above, with rate limits |
| `src/routes/admin.routes.js` | Account management for the console: list, create, suspend or restore, temporary password, delete |
| `src/models/User.js` | Adds `failedLogins`, `lockedOut`, `tempPassword` and `passwordChangedAt` |
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
  - The server counts wrong passwords. When the count reaches the console's limit (5 by default), the account is locked and the administrators are notified. An administrator unlocks it from the console, either by restoring the account or by setting a temporary password.
  - Administrator accounts don't lock, so nobody can lock every admin out. They are rate-limited like everyone else.
- **Administrator code.** The six-digit step after an admin's password is now checked on the server against `ADMIN_LOGIN_CODE`. Leave it empty to switch the step off. A per-person authenticator app would be the stronger next step.
- **Sign-out really signs out.** Tokens are revoked on sign-out, password change and suspension (`tokenVersion` on the user).
- **Forgot password.** There is no email service, so a request notifies the administrators. They issue a temporary password from the console and pass it on. When the person signs in with it, they're reminded to choose a new one in Settings.
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

**Not fixed: decisions for the team.** A few of the original tests fail for reasons that have nothing to do with this work. The table in the [README](../README.md#tests) gives each one with a suggested fix.

Separately, the timed-reading "allowed hours" check uses the server's time zone. On a host running in UTC, an Australian family's 7 pm limit would be checked at 7 pm UTC.

## How it was tested

- **API:** 48 new Jest and Supertest tests (`npm run test:api`) cover:
  - sign-up, sign-in, lockout and the admin code;
  - the console's account tools;
  - the shelf and per-person data;
  - moderation, support and notifications;
  - carers, chat, share links;
  - basics: 404s, bad JSON, security headers, CORS and rate limits.
- **Original suites:** they pass, apart from the known failures listed in the README.
- **In a real browser:** 24 end-to-end checks ran against the full stack (API, database and site) in Chromium. They covered:
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
  - a session ended on another device.
- **Database caveat:** MongoDB itself couldn't be installed where this was built, so all of the above ran against a MongoDB-compatible stand-in. Before going live, run `npm test` once with `MONGODB_URI` pointing at a real test database (Atlas is fine), and click through the site once.

## Known limits and next steps

- **Retention settings only hide old entries.** The console's "keep the activity log / decided suggestions for N days" settings filter what the console shows; the records stay in the database. If the privacy policy promises deletion, add a scheduled clean-up job or MongoDB TTL indexes. "Close dormant accounts" does take effect, but only while an administrator has the console open, because the console is what runs it.
- **Polling, not live updates.** Shared things (board, reviews, chat, notifications) refresh every 20 seconds and when the tab regains focus (`pollSeconds` in `config.js`). Chat isn't instant. WebSockets or server-sent events would be the upgrade.
- **Screenshots** for problem reports are stored in MongoDB, up to 2 MB each. Move them to object storage (S3, Cloudinary) if there will be many.
- **No outgoing email.** Password resets go through administrators. A carer invitation reaches the invited person only if they already have an account; otherwise they see it after signing up with that email.
- **Rate limits** are kept in memory, so they reset when the server restarts and aren't shared between instances. Use Redis if you run more than one.
- **Original features not used by the frontend yet:** the catalogue (`/api/books`), parental controls, timed reading sessions, and students' wishlist and reviews.

## Applying the patches instead of the zips

Backend, in your clone of `PrashantTown/books`:

```bash
git checkout -b frontend-integration cbb5ecf
git am /path/to/backend-frontend-integration.patch
npm install
```

Frontend: see "Applying the patch" in the frontend's `BACKEND.md`.
