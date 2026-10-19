const { harness } = require("./helpers/apiHarness");
const User = require("../src/models/User");
const Notification = require("../src/models/Notification");
const AuditLog = require("../src/models/AuditLog");
const Child = require("../src/models/Child");
const ShelfBook = require("../src/models/ShelfBook");

const h = harness("auth");

let admin;
let adminToken;

beforeAll(async () => {
  await h.connect();
  admin = await h.makeUser("admin", "admin");
  adminToken = await h.login(admin);
}, 30000);

afterAll(async () => {
  await h.cleanup();
}, 30000);

describe("Sign-up", () => {
  test("creates a parent account by default and refuses other roles", async () => {
    const ok = await h.request().post("/api/auth/register").send({ name: "Pat Parent", email: h.email("signup"), password: "LongEnough1!" });
    expect(ok.status).toBe(201);
    expect(ok.body.user.role).toBe("parent");
    expect(ok.body.token).toBeTruthy();
    expect(ok.body.user).not.toHaveProperty("password");

    const adminTry = await h.request().post("/api/auth/register").send({ name: "Sneaky", email: h.email("sneaky"), password: "LongEnough1!", role: "admin" });
    expect(adminTry.status).toBe(403);
    expect(await User.exists({ email: h.email("sneaky") })).toBeNull();

    const studentTry = await h.request().post("/api/auth/register").send({ name: "Kid", email: h.email("kid"), password: "LongEnough1!", role: "student" });
    expect(studentTry.status).toBe(403);
  });

  test("validates email, name and password length", async () => {
    expect((await h.request().post("/api/auth/register").send({ name: "A", email: h.email("short"), password: "LongEnough1!" })).status).toBe(400);
    expect((await h.request().post("/api/auth/register").send({ name: "Real Name", email: "not-an-email", password: "LongEnough1!" })).status).toBe(400);
    expect((await h.request().post("/api/auth/register").send({ name: "Real Name", email: h.email("weak"), password: "short" })).status).toBe(400);
  });
});

describe("Sign-in", () => {
  test("checks the side the person is signing in to, after the password", async () => {
    const parent = await h.makeUser("sidecheck");

    const asAdmin = await h.request().post("/api/auth/login").send({ email: parent.email, password: h.PASSWORD, role: "admin" });
    expect(asAdmin.status).toBe(403);
    expect(asAdmin.body.code).toBe("NOT_ADMIN");

    const wrongPw = await h.request().post("/api/auth/login").send({ email: parent.email, password: "nope-nope", role: "admin" });
    expect(wrongPw.status).toBe(401);

    const adminAsParent = await h.request().post("/api/auth/login").send({ email: admin.email, password: h.PASSWORD, role: "parent" });
    expect(adminAsParent.status).toBe(403);
    expect(adminAsParent.body.code).toBe("USE_ADMIN");

    const fine = await h.request().post("/api/auth/login").send({ email: parent.email, password: h.PASSWORD, role: "parent" });
    expect(fine.status).toBe(200);
  });

  test("locks a parent account after too many wrong passwords and tells the admins", async () => {
    const parent = await h.makeUser("locky");
    let last;
    for (let i = 0; i < 5; i++) {
      last = await h.request().post("/api/auth/login").send({ email: parent.email, password: "wrong-password" });
    }
    expect(last.status).toBe(403);
    expect(last.body.code).toBe("ACCOUNT_LOCKED");

    const stored = await User.findById(parent._id);
    expect(stored.status).toBe("suspended");
    expect(stored.lockedOut).toBe(true);

    const right = await h.request().post("/api/auth/login").send({ email: parent.email, password: h.PASSWORD });
    expect(right.status).toBe(403);
    expect(right.body.code).toBe("ACCOUNT_LOCKED");

    expect(await Notification.exists({ to: "admin::*", tag: `locked-${parent.email}` })).toBeTruthy();
    expect(await AuditLog.exists({ who: parent.email, what: /locked/i })).toBeTruthy();
  });

  test("reports attempts left before the lock", async () => {
    const parent = await h.makeUser("attempts");
    const res = await h.request().post("/api/auth/login").send({ email: parent.email, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.attemptsLeft).toBe(4);
  });

  test("asks administrators for the one-time code when one is configured", async () => {
    process.env.ADMIN_LOGIN_CODE = "246810";
    try {
      const step1 = await h.request().post("/api/auth/login").send({ email: admin.email, password: h.PASSWORD, role: "admin" });
      expect(step1.status).toBe(200);
      expect(step1.body.codeRequired).toBe(true);
      expect(step1.body.token).toBeUndefined();

      const wrong = await h.request().post("/api/auth/admin-code").send({ challenge: step1.body.challenge, code: "111111" });
      expect(wrong.status).toBe(401);
      expect(wrong.body.attemptsLeft).toBe(2);

      const right = await h.request().post("/api/auth/admin-code").send({ challenge: step1.body.challenge, code: "246810" });
      expect(right.status).toBe(200);
      expect(right.body.token).toBeTruthy();

      // A challenge can only be used once.
      const replay = await h.request().post("/api/auth/admin-code").send({ challenge: step1.body.challenge, code: "246810" });
      expect(replay.status).toBe(401);

      // Three wrong codes abandon the attempt.
      const again = await h.request().post("/api/auth/login").send({ email: admin.email, password: h.PASSWORD, role: "admin" });
      for (let i = 0; i < 2; i++) {
        await h.request().post("/api/auth/admin-code").send({ challenge: again.body.challenge, code: "000000" });
      }
      const third = await h.request().post("/api/auth/admin-code").send({ challenge: again.body.challenge, code: "000000" });
      expect(third.body.code).toBe("CODE_ABANDONED");
      const late = await h.request().post("/api/auth/admin-code").send({ challenge: again.body.challenge, code: "246810" });
      expect(late.status).toBe(401);
    } finally {
      process.env.ADMIN_LOGIN_CODE = "";
    }
  });
});

describe("Account settings", () => {
  test("updates name and email, refusing an email that is taken", async () => {
    const parent = await h.makeUser("details");
    const other = await h.makeUser("taken");
    const token = await h.login(parent);

    const taken = await h.as(token).patch("/api/auth/me", { email: other.email });
    expect(taken.status).toBe(409);

    const res = await h.as(token).patch("/api/auth/me", { name: "New Name", email: h.email("details2") });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("New Name");
    expect(res.body.user.email).toBe(h.email("details2"));

    const me = await h.as(token).get("/api/auth/me");
    expect(me.body.user.email).toBe(h.email("details2"));
  });

  test("changes the password and signs other sessions out", async () => {
    const parent = await h.makeUser("pwchange");
    const token = await h.login(parent);

    const wrong = await h.as(token).put("/api/auth/password", { currentPassword: "nope", newPassword: "BrandNew123!" });
    expect(wrong.status).toBe(401);

    const res = await h.as(token).put("/api/auth/password", { currentPassword: h.PASSWORD, newPassword: "BrandNew123!" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();

    expect((await h.as(token).get("/api/auth/me")).status).toBe(401);
    expect((await h.as(res.body.token).get("/api/auth/me")).status).toBe(200);
    expect((await h.request().post("/api/auth/login").send({ email: parent.email, password: "BrandNew123!" })).status).toBe(200);
  });

  test("forgot password answers the same either way and alerts admins for real accounts", async () => {
    const parent = await h.makeUser("forgot");
    const known = await h.request().post("/api/auth/forgot-password").send({ email: parent.email });
    const unknown = await h.request().post("/api/auth/forgot-password").send({ email: h.email("nobody") });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);
    expect(await Notification.exists({ to: "admin::*", tag: `reset-${parent.email}` })).toBeTruthy();
  });

  test("deletes the account and its data after confirming the password", async () => {
    const parent = await h.makeUser("leaver");
    const token = await h.login(parent);
    await h.as(token).patch("/api/shelf", {
      ops: [
        { op: "put", type: "child", id: "c1", data: { name: "Harry", age: 6, band: "5–7", likes: [] } },
        { op: "put", type: "book", id: "b1", data: { title: "The Gruffalo" } },
      ],
    });

    expect((await h.as(token).delete("/api/auth/me", { password: "wrong" })).status).toBe(401);
    const res = await h.as(token).delete("/api/auth/me", { password: h.PASSWORD });
    expect(res.status).toBe(200);

    expect(await User.exists({ _id: parent._id })).toBeNull();
    expect(await Child.exists({ parent: parent._id })).toBeNull();
    expect(await ShelfBook.exists({ owner: parent._id })).toBeNull();
  });
});

describe("Admin account management", () => {
  test("lists parents and admins with shelf counts, hiding student logins", async () => {
    const parent = await h.makeUser("listed");
    const token = await h.login(parent);
    await h.as(token).patch("/api/shelf", {
      ops: [
        { op: "put", type: "child", id: "c1", data: { name: "Leo", age: 9, band: "7–9" } },
        { op: "put", type: "book", id: "b1", data: { title: "Charlotte's Web" } },
        { op: "put", type: "wish", id: "w1", data: { title: "Amulet" } },
      ],
    });
    await h.makeUser("studentx", "student");

    const res = await h.as(adminToken).get("/api/admin/users");
    expect(res.status).toBe(200);
    const row = res.body.users.find((u) => u.email === parent.email);
    expect(row.shelf).toEqual({ children: 1, books: 1, wishlist: 1, sessions: 0 });
    expect(res.body.users.some((u) => u.role === "student")).toBe(false);

    expect((await h.as(token).get("/api/admin/users")).status).toBe(403);
  });

  test("suspends (signing them out), restores and sets a temporary password", async () => {
    const parent = await h.makeUser("managed");
    const token = await h.login(parent);

    const suspended = await h.as(adminToken).patch(`/api/admin/users/${parent._id}/status`, { status: "suspended" });
    expect(suspended.status).toBe(200);
    expect((await h.as(token).get("/api/auth/me")).status).toBe(403);

    const temp = await h.as(adminToken).post(`/api/admin/users/${parent._id}/temp-password`, { password: "Temporary99" });
    expect(temp.status).toBe(200);
    expect(temp.body.user.status).toBe("active");

    const login = await h.request().post("/api/auth/login").send({ email: parent.email, password: "Temporary99" });
    expect(login.status).toBe(200);
    expect(login.body.user.tempPassword).toBe(true);

    expect((await h.as(adminToken).patch(`/api/admin/users/${admin._id}/status`, { status: "suspended" })).status).toBe(400);
  });

  test("creates another administrator and deletes accounts", async () => {
    const created = await h.as(adminToken).post("/api/admin/users", {
      name: "Second Admin",
      email: h.email("admin2"),
      password: "AdminPassword123",
      role: "admin",
    });
    expect(created.status).toBe(201);
    expect(created.body.user.role).toBe("admin");

    const shortPw = await h.as(adminToken).post("/api/admin/users", { name: "Bad Admin", email: h.email("admin3"), password: "short1234", role: "admin" });
    expect(shortPw.status).toBe(400);

    const removed = await h.as(adminToken).delete(`/api/admin/users/${created.body.user.id}`);
    expect(removed.status).toBe(200);
    expect(await User.exists({ email: h.email("admin2") })).toBeNull();
  });
});
