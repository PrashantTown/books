# Parents Go To API reference

Base URL: `http://localhost:5000` locally, or your deployed address.

## Conventions

- Bodies and responses are JSON. Every response has `success: true|false`; errors also have a `message` written for people, and sometimes a `code` for programs.
- **Auth:** send `Authorization: Bearer <token>`. Tokens come from sign-in or sign-up and last 7 days. Columns below say who may call each endpoint:
  - **public** — no token
  - **signed in** — any account
  - **parent** / **admin** — that role only
- **Ids:** records created by the frontend keep the frontend's own id (`"b1"`, `"bd-x7k2m9p0"`), returned as `id`. Times the frontend shows are milliseconds since 1970 (`at`, `decidedAt` …).
- **Common errors:** `400` invalid input · `401` no or expired token · `403` not allowed · `404` not found · `409` conflict (already exists) · `413` too large · `429` too many requests (`Retry-After` header) · `500` server error.

---

## Accounts and sign-in — `/api/auth`

| Method | Path | Who | What |
|---|---|---|---|
| POST | `/register` | public | Create a **parent** account. Body `{ name, email, password }` (password 8+). `role` other than `"parent"` → 403. Returns `{ token, user }`. Duplicate email → 409 |
| POST | `/login` | public | Body `{ email, password, role? }`. `role` (`"parent"`/`"admin"`) checks the account is that kind, after the password. Returns `{ token, user }`, or for administrators when `ADMIN_LOGIN_CODE` is set `{ codeRequired: true, challenge }` |
| POST | `/admin-code` | public | Body `{ challenge, code }` → `{ token, user }`. Three wrong codes end the attempt |
| POST | `/forgot-password` | public | Body `{ email }`. Always the same answer; for a real account the administrators get a notification to issue a temporary password |
| GET | `/me` | signed in | The current user |
| PATCH | `/me` | signed in | Body `{ name?, email? }`. Email taken → 409. Changing email also moves chats, invitations and notifications to the new address |
| PUT | `/password` | signed in | Body `{ currentPassword, newPassword }` (parents 8+, admins 12+). Signs out other devices; returns a new `token`. Wrong current → 401 `WRONG_PASSWORD` |
| DELETE | `/me` | signed in | Body `{ password }`. Deletes the account and everything in it. The last active admin can't delete themselves (409) |
| POST | `/logout` | signed in | Revokes the token |

**Sign-in error codes** (`403` unless noted): `ACCOUNT_LOCKED` (too many wrong passwords), `ACCOUNT_SUSPENDED`, `NOT_ADMIN`, `USE_ADMIN` (admin account on the parent side), `NOT_PARENT`. A wrong password is `401` with `attemptsLeft`. Admin code: `WRONG_CODE` (with `attemptsLeft`), `CODE_ABANDONED`, `CHALLENGE_EXPIRED`.

`user` = `{ id, name, email, role, status, tempPassword }` (`tempPassword: true` means they should choose a new password).

## Administration — `/api/admin` (admin)

| Method | Path | What |
|---|---|---|
| GET | `/dashboard` | Counts of users and catalogue books (original endpoint) |
| GET | `/users?role=&status=&q=` | Parents and admins (students hidden unless `role=student` or `all`). Each: `{ id, email, name, role, status, lockedOut, tempPassword, createdAt, lastSeen, passwordChangedAt, shelf: { children, books, wishlist, sessions } }` |
| POST | `/users` | Body `{ name, email, password, role: "parent"\|"admin" }` |
| PATCH | `/users/:id/status` | Body `{ status: "active"\|"suspended" }`. Suspending signs them out. Not your own account |
| POST | `/users/:id/temp-password` | Body `{ password? }` (generated if missing). Also restores access. Returns `{ password }` |
| DELETE | `/users/:id` | Deletes the account and its data. Not your own |

## Family shelf — `/api/shelf` (parent)

A shelf is `{ parent: { name, email, colour }, children, books, wishlist, sessions, activity, bedtime }`:

- child `{ id, name, age (0–18 or null), band, colour, likes[] }` — stored in the same collection as `/api/children`
- book / wishlist item `{ id, title, author, category, ages, status: "toread"|"reading"|"read", who[childIds], spine, cover, notes, pages?, page?, rating?, started?, finished?, added? }` plus any extra fields the frontend keeps
- session (reading log) `{ id, bookId, childId|null, date "YYYY-MM-DD", minutes, page? }`
- activity `[{ text, at }]` (latest 12), bedtime `{ start "HH:MM", winddown, autoSwitch }`

| Method | Path | What |
|---|---|---|
| GET | `/` | The whole shelf |
| PATCH | `/` | Apply a batch: `{ ops: [{ op: "put"\|"delete", type: "child"\|"book"\|"wish"\|"session", id, data }], order?: { children, books, wishlist, sessions } (id lists), meta?: { colour, activity, bedtime } }`. Returns `{ shelf, rejected: [{ index, id, type, message }] }` — valid changes are kept even if some are rejected |
| GET | `/books?list=library\|wishlist` | Books in one list |
| POST | `/books?list=…` | Add a book (body = book; `id` optional) |
| PUT | `/books/:id?list=…` | Replace a book |
| DELETE | `/books/:id?list=…` | Remove a book |
| GET | `/sessions?childId=&from=&to=` | Reading log, newest first |
| POST | `/sessions` | Add an entry |
| DELETE | `/sessions/:id` | Remove an entry |

Limits: 30 children, 5,000 books, 20,000 log entries per family.

## Per-person data — `/api/me/data` (signed in)

Small JSON documents, one per key: `prefs` (settings, up to 300 KB including the profile photo), `genres`, `kidLooks`, `welcome`.

| Method | Path | What |
|---|---|---|
| GET | `/` | `{ data: { prefs, genres, kidLooks, welcome } }` (null when unset) |
| GET | `/:key` | `{ value }` |
| PUT | `/:key` | Body `{ value: {…} }`. Keys starting with `$` or containing `.` are refused |
| DELETE | `/:key` | Remove it |

`GET /api/settings/platform` (signed in) → `{ settings: { holdAll, flagNames, linkAllow, lockAttempts, logRetention, subRetention, dormantAfter } }` — the platform rules, taken from the most recently saved administrator settings.

## Community — `/api/community` (parents and admins)

All three follow the same moderation pattern. New items are checked on the server: by default **everything is held for review** (`holdAll`); with that off, items naming a person (`flagNames`) or linking outside trusted sites (`linkAllow`) are held. Items that pass go straight up with `decidedBy: "Automatic"`.

### Message board
| Method | Path | Who | What |
|---|---|---|---|
| GET | `/board` | parent, admin | Published posts and your own (admins: all, newest 500) |
| POST | `/board` | parent | `{ id?, body (10–600), ages?, parentId? }` (`parentId` = post being replied to) |
| PATCH | `/board/:id/moderation` | admin | `{ state: "published"\|"removed"\|"pending", reason }` (reason required for removed) |
| DELETE | `/board/:id` | owner or admin | Deletes it and its replies |

Post: `{ id, from, owner, body, ages, at, state, reason, decidedBy, decidedAt, parentId }`.

### Parents' book reviews
| Method | Path | Who | What |
|---|---|---|---|
| GET | `/reviews?book=<key>` | parent, admin | Published + your own (admins: all). `key` = `"title|author"` normalised |
| POST | `/reviews` | parent | `{ id?, bookTitle, bookAuthor, rating 1–5, body (10–500) }`. One per book per parent (409) |
| PATCH | `/reviews/:id` | owner | `{ rating?, body? }` — goes back through moderation |
| PATCH | `/reviews/:id/moderation` | admin | as for the board |
| DELETE | `/reviews/:id` | owner or admin | |

These are separate from `/api/reviews`, which are students' reviews of catalogue books.

### Resource suggestions
| Method | Path | Who | What |
|---|---|---|---|
| GET | `/suggestions` | parent, admin | Your own + approved (admins: all) |
| POST | `/suggestions` | parent | `{ id?, title, body, link (http/https), category, ages }` |
| PATCH | `/suggestions/:id/moderation` | admin | `{ state: "approved"\|"rejected"\|"pending", reason }` |
| DELETE | `/suggestions/:id` | owner or admin | |

## Resources — `/api/resources`

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/` | signed in | Published (admins also see drafts) |
| POST | `/` | admin | `{ id?, title, body, category, ages, link, state: "draft"\|"published" }` |
| PUT | `/:id` | admin | Edit |
| DELETE | `/:id` | admin | |

## Support — `/api/support`

| Method | Path | Who | What |
|---|---|---|---|
| POST | `/` | public or signed in | `{ id?, ref?, body, area, severity: "low"\|"med"\|"high", severityText, diag, replyTo, shot? }`. Visitors also send `name` and `from` (email); the admins are notified. A well-formed unused `ref` (`PTG-…`) is kept, otherwise one is assigned |
| GET | `/` | signed in | Your own (admins: all) |
| PATCH | `/:id` | admin | `{ state: "open"\|"progress"\|"closed" }` |
| POST | `/:id/screenshot` | the reporter | `{ dataUrl: "data:image/png;base64,…", name }` — PNG, JPEG, WebP or GIF, up to 2 MB |
| GET | `/:id/screenshot` | reporter or admin | The image |
| DELETE | `/:id/screenshot` | reporter or admin | |

Rate-limited per visitor (`RATE_LIMIT_CONTACT`).

## Notifications — `/api/notifications` (parents and admins)

Addresses: `parent::email`, `admin::email`, `parent::*` (all parents), `admin::*` (all admins).

| Method | Path | What |
|---|---|---|
| GET | `/` | Yours, newest 80: `{ id, to, kind, tone, title, body, go, tag, at, read, count? }` |
| POST | `/` | `{ id?, to, kind, tone, title, body, go, tag }`. Admins may send to anyone; parents only to themselves or `admin::*`. An unread duplicate (same address, tag and title) is merged and its `count` goes up |
| POST | `/:id/read` | Mark read (for you only) |
| POST | `/read-all` | Mark all yours read |
| DELETE | `/:id` | Dismiss (a broadcast is hidden for you only) |
| DELETE | `/` | Clear all yours |

## Activity log — `/api/audit`

| Method | Path | Who | What |
|---|---|---|---|
| POST | `/` | parent, admin | `{ id?, kind, what, detail }` — recorded as you |
| GET | `/?limit=&kind=` | admin | Newest first (default 400, max 2,000) |

The server also logs sign-ins, sign-outs, lockouts, password changes and resets, and account deletions itself.

## Carers — `/api/family` (parent)

| Method | Path | What |
|---|---|---|
| GET | `/` | Invitations you sent, and ones sent to your email (`incoming: true`) |
| POST | `/` | `{ id?, name, email }` — up to 12 active; the invited person is notified if they have an account |
| POST | `/:id/accept` | Accept an invitation sent to your email |
| POST | `/:id/withdraw` | Withdraw one you sent, or decline/leave one sent to you |

Invitation: `{ id, ref, owner, name, email, role, state: "invited"|"accepted"|"withdrawn", by, byName, at, acceptedAt, withdrawnAt, withdrawnBy, incoming }`.

## Chat — `/api/chat` (parent)

Member ids: `mail:<email>` for an adult, `kid:<parent email>:<child id>` for a child's profile.

| Method | Path | What |
|---|---|---|
| GET | `/` | `{ chat: { threads, msgs: { threadId: [...] }, reads: { "threadId|memberId": ms } } }` |
| POST | `/threads` | `{ id?, kind: "family"\|"shelf", key, title, account, members[], names{} }`. Family threads are you and your own children's profiles; shelf threads need an accepted carer invitation. Same `key` again returns the existing thread |
| POST | `/threads/:id/messages` | `{ id?, from, name?, body }` — `from` must be you or one of your children's profiles |
| PUT | `/threads/:id/read` | `{ member, at }` |
| PATCH | `/threads/:id` | `{ state: "open"\|"closed" }` |
| DELETE | `/threads/:id` | Only whoever started it |

## Shared wishlists — `/api/share`

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/mine` | parent | Your link or `null` |
| PUT | `/mine` | parent | `{ token?, scope: "link"\|"invite", initials, expiry: "7"\|"30"\|"never", ownerName, items: [{ title, author, catName, ages, spine, forNames[] }] }` |
| DELETE | `/mine` | parent | Turn sharing off |
| GET | `/:token` | public | The shared list; `404` unknown, `410` expired |

---

## Original endpoints (unchanged)

These were in the repo before the frontend work and keep working as before. The current frontend doesn't use them yet.

| Area | Endpoints |
|---|---|
| Children | `POST/GET /api/children`, `GET/PUT/DELETE /api/children/:id` (parent) — creating a child also creates a student login |
| Catalogue | `GET /api/books` (search, filter, paginate), `GET /api/books/:id`; admin: `POST`, `PUT /:id`, `DELETE /:id` (archive), `PATCH /:id/activate`, `PATCH /:id/deactivate` |
| Parental controls | `GET/POST/PUT /api/parental-controls/:childId`, `PATCH /:childId/enable`, `PATCH /:childId/disable`, `GET /:childId/external-links` |
| Timed reading | `POST /api/reading-sessions/start`, `POST /:id/end`, `GET /usage/today`, `GET /history`, `GET /remaining-time` (a student's own), `GET /remaining-time/:childId` |
| Student wishlist | `POST/DELETE /api/wishlist/:bookId`, `GET /api/wishlist`, `GET /:bookId/status` |
| Student reviews | `POST /api/reviews/:bookId`, `GET /book/:bookId`, `GET /book/:bookId/summary`, `GET/PUT/DELETE /:id` |
| Health | `GET /api/health` |

Changes to original endpoints:
- **For safety:**
  - `POST /api/auth/register` no longer accepts `role: "admin"` or `"student"`; it defaults to parent.
  - `POST /api/auth/login` now locks parent accounts after repeated wrong passwords.
- **To match the original tests:**
  - Another family's child is 403 on `/api/children/:id`.
  - A student review's rating is validated before the book.
  - Students whose child has no parental controls get 403 from the reading usage, remaining-time and history endpoints.
