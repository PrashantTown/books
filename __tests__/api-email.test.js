const { harness, PASSWORD } = require("./helpers/apiHarness");
const User = require("../src/models/User");
const { mailOutbox } = require("../src/utils/mailer");

// Email: "Forgot your password?" links and new-account confirmation. A
// one-time link is emailed and opened on the site. MAIL_PROVIDER=log keeps the
// emails in memory instead of sending them.

const h = harness("reset");
const before = process.env.MAIL_PROVIDER;

let parent;
let admin;

const linkFor = (email, kind = "reset") => {
  const mail = mailOutbox.filter((m) => m.to === email && m.text.includes(`#${kind}=`)).pop();
  return mail ? mail.text.match(new RegExp(`https?://\\S+#${kind}=([0-9a-f]{64})`)) : null;
};

const forgot = (email, origin = "http://localhost:5500") =>
  h.request().post("/api/auth/forgot-password").set("Origin", origin).send({ email });

beforeAll(async () => {
  process.env.MAIL_PROVIDER = "log";
  await h.connect();
  parent = await h.makeUser("parent");
  admin = await h.makeUser("admin", "admin");
}, 30000);

afterAll(async () => {
  if (before === undefined) delete process.env.MAIL_PROVIDER;
  else process.env.MAIL_PROVIDER = before;
  await h.cleanup();
}, 30000);

describe("Resetting a password by email", () => {
  test("emails a one-time link back to the site, and the same answer for unknown emails", async () => {
    const res = await forgot(parent.email);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("email");
    const link = linkFor(parent.email);
    expect(link).toBeTruthy();
    expect(link[0].startsWith("http://localhost:5500/reading-for-pleasure.html#reset=")).toBe(true);

    const stored = await User.findById(parent._id);
    expect(stored.resetTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.resetTokenHash).not.toBe(link[1]); // only a hash is kept

    const unknown = await forgot(`nobody.${h.runId}@test.com`);
    expect(unknown.body).toEqual(res.body);
    expect(linkFor(`nobody.${h.runId}@test.com`)).toBeNull();

    // Asking again straight away doesn't send another email.
    const count = mailOutbox.filter((m) => m.to === parent.email).length;
    await forgot(parent.email);
    expect(mailOutbox.filter((m) => m.to === parent.email).length).toBe(count);
  });

  test("the link sets a new password once, signs the parent in, and signs out other sessions", async () => {
    const oldSession = await h.login(parent);
    const token = linkFor(parent.email)[1];

    expect((await h.request().post("/api/auth/reset-password").send({ token, password: "short" })).status).toBe(400);

    const done = await h.request().post("/api/auth/reset-password").send({ token, password: "Brand-New-Pass-1" });
    expect(done.status).toBe(200);
    expect(done.body.token).toBeTruthy();
    expect(done.body.user.email).toBe(parent.email);
    expect((await h.as(done.body.token).get("/api/auth/me")).status).toBe(200);
    expect((await h.as(oldSession).get("/api/auth/me")).status).toBe(401);

    const again = await h.request().post("/api/auth/reset-password").send({ token, password: "Another-Pass-22" });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("RESET_EXPIRED");

    expect((await h.request().post("/api/auth/login").send({ email: parent.email, password: PASSWORD })).status).toBe(401);
    expect((await h.request().post("/api/auth/login").send({ email: parent.email, password: "Brand-New-Pass-1" })).status).toBe(200);
  });

  test("links stop working after 30 minutes", async () => {
    await User.updateOne({ _id: parent._id }, { $set: { resetRequestedAt: null } });
    await forgot(parent.email);
    const token = linkFor(parent.email)[1];
    await User.updateOne({ _id: parent._id }, { $set: { resetTokenExpires: new Date(Date.now() - 1000) } });
    const res = await h.request().post("/api/auth/reset-password").send({ token, password: "Too-Late-Pass-1" });
    expect(res.body.code).toBe("RESET_EXPIRED");
  });

  test("a reset lifts a lockout from wrong passwords", async () => {
    const locked = await h.makeUser("locked", "parent", { status: "suspended", lockedOut: true });
    await forgot(locked.email);
    const token = linkFor(locked.email)[1];
    const res = await h.request().post("/api/auth/reset-password").send({ token, password: "Unlocked-Pass-1" });
    expect(res.status).toBe(200);
    const after = await User.findById(locked._id);
    expect(after).toMatchObject({ status: "active", lockedOut: false, failedLogins: 0 });
  });

  test("administrators sign in again afterwards, so the administrator code still applies", async () => {
    await forgot(admin.email);
    const token = linkFor(admin.email)[1];
    const res = await h.request().post("/api/auth/reset-password").send({ token, password: "Admin-New-Pass-123" });
    expect(res.status).toBe(200);
    expect(res.body.signIn).toBe(true);
    expect(res.body.token).toBeUndefined();
  });

  test("without email set up, the administrators are told instead", async () => {
    process.env.MAIL_PROVIDER = "";
    const res = await forgot(parent.email);
    expect(res.body.mode).toBe("admin");
    process.env.MAIL_PROVIDER = "log";
  });
});

describe("Confirming the email address of a new account", () => {
  const email = () => `newbie.${h.runId}@test.com`;

  test("signing up emails a link, and the account can't sign in until it's opened", async () => {
    const res = await h
      .request()
      .post("/api/auth/register")
      .set("Origin", "http://localhost:5500")
      .send({ name: "Nina Newbie", email: email(), password: "Nina-Pass-1234" });
    expect(res.status).toBe(201);
    expect(res.body.confirm).toBe(true);
    expect(res.body.token).toBeUndefined();
    expect(linkFor(email(), "confirm")).toBeTruthy();

    const login = await h.request().post("/api/auth/login").send({ email: email(), password: "Nina-Pass-1234" });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe("EMAIL_NOT_CONFIRMED");
    // A wrong password still says only that the password is wrong.
    const wrong = await h.request().post("/api/auth/login").send({ email: email(), password: "nope-nope" });
    expect(wrong.status).toBe(401);
  });

  test("a new link can be sent; only the newest one works, and only once", async () => {
    const first = linkFor(email(), "confirm")[1];
    await User.updateOne({ email: email() }, { $set: { confirmSentAt: null } });
    const again = await h.request().post("/api/auth/resend-confirmation").send({ email: email() });
    expect(again.status).toBe(200);
    const second = linkFor(email(), "confirm")[1];
    expect(second).not.toBe(first);

    expect((await h.request().post("/api/auth/confirm-email").send({ token: first })).body.code).toBe("CONFIRM_EXPIRED");
    const done = await h.request().post("/api/auth/confirm-email").send({ token: second });
    expect(done.status).toBe(200);
    expect(done.body.token).toBeTruthy();
    expect((await h.as(done.body.token).get("/api/auth/me")).body.user.email).toBe(email());
    expect((await h.request().post("/api/auth/confirm-email").send({ token: second })).status).toBe(400);

    const login = await h.request().post("/api/auth/login").send({ email: email(), password: "Nina-Pass-1234" });
    expect(login.status).toBe(200);
  });

  test("resending for an unknown or confirmed account answers the same and sends nothing", async () => {
    const sent = mailOutbox.length;
    const unknown = await h.request().post("/api/auth/resend-confirmation").send({ email: `ghost.${h.runId}@test.com` });
    const confirmed = await h.request().post("/api/auth/resend-confirmation").send({ email: parent.email });
    expect(unknown.body).toEqual(confirmed.body);
    expect(mailOutbox.length).toBe(sent);
  });

  test("without email set up, new accounts are ready straight away", async () => {
    process.env.MAIL_PROVIDER = "";
    const res = await h.request().post("/api/auth/register").send({ name: "Ollie Offline", email: `ollie.${h.runId}@test.com`, password: "Ollie-Pass-1234" });
    process.env.MAIL_PROVIDER = "log";
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.confirm).toBeUndefined();
  });
});

describe("Administrators get their own sign-in code by email", () => {
  const codeFor = (email) => {
    const mail = mailOutbox.filter((m) => m.to === email && /sign-in code/.test(m.subject)).pop();
    return mail ? mail.text.match(/\b(\d{6})\b/)[1] : null;
  };
  let boss;

  beforeAll(async () => {
    boss = await h.makeUser("boss", "admin");
  });

  const startLogin = async () => {
    const res = await h.request().post("/api/auth/login").send({ email: boss.email, password: PASSWORD, role: "admin" });
    expect(res.status).toBe(200);
    return res.body;
  };

  test("the code goes to the address they sign in with, and works once", async () => {
    const started = await startLogin();
    expect(started).toMatchObject({ codeRequired: true, via: "email" });
    expect(started.token).toBeUndefined();
    expect(started.sentTo).toMatch(/^b\*+@test\.com$/);
    const code = codeFor(boss.email);
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await h.request().post("/api/auth/admin-code").send({ challenge: started.challenge, code: code === "000000" ? "111111" : "000000" });
    expect(wrong.body.code).toBe("WRONG_CODE");

    const ok = await h.request().post("/api/auth/admin-code").send({ challenge: started.challenge, code });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();

    // Used: a fresh sign-in can't reuse it.
    const again = await startLogin();
    const reused = await h.request().post("/api/auth/admin-code").send({ challenge: again.challenge, code });
    expect(reused.status).toBe(401);
  });

  test("an expired code is refused", async () => {
    const started = await startLogin();
    const code = codeFor(boss.email);
    await User.updateOne({ _id: boss._id }, { $set: { adminCodeExpires: new Date(Date.now() - 1000) } });
    const res = await h.request().post("/api/auth/admin-code").send({ challenge: started.challenge, code });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("CHALLENGE_EXPIRED");
  });

  test("three wrong codes end the attempt", async () => {
    const started = await startLogin();
    const code = codeFor(boss.email);
    const bad = code === "999999" ? "888888" : "999999";
    for (let i = 0; i < 2; i++) {
      expect((await h.request().post("/api/auth/admin-code").send({ challenge: started.challenge, code: bad })).body.code).toBe("WRONG_CODE");
    }
    expect((await h.request().post("/api/auth/admin-code").send({ challenge: started.challenge, code: bad })).body.code).toBe("CODE_ABANDONED");
    expect((await h.request().post("/api/auth/admin-code").send({ challenge: started.challenge, code })).status).toBe(401);
  });

  test("parents never get a code", async () => {
    const res = await h.request().post("/api/auth/login").send({ email: parent.email, password: "Brand-New-Pass-1" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.codeRequired).toBeUndefined();
  });
});

describe("Emails to the team, invitations and new administrators", () => {
  const latestTo = (email, re) => mailOutbox.filter((m) => m.to === email && (!re || re.test(m.subject))).pop();
  // Team emails go out after the answer (the visitor doesn't wait for them),
  // so give them a moment to arrive; on a remote database that takes longer.
  const waitForMail = async (email, re, ms = 10000) => {
    const end = Date.now() + ms;
    for (;;) {
      const mail = latestTo(email, re);
      if (mail || Date.now() > end) return mail;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  let chief;
  let chiefToken;

  beforeAll(async () => {
    chief = await h.makeUser("chief", "admin");
    const started = await h.request().post("/api/auth/login").send({ email: chief.email, password: PASSWORD, role: "admin" });
    const mail = latestTo(chief.email, /sign-in code/);
    const code = mail.text.match(/\b(\d{6})\b/)[1];
    chiefToken = (await h.request().post("/api/auth/admin-code").send({ challenge: started.body.challenge, code })).body.token;
  });

  test("the health check says email is on", async () => {
    expect((await h.request().get("/api/health")).body.email).toBe(true);
  });

  test("a contact-page message is emailed to the administrators, and replies go to the sender", async () => {
    const res = await h
      .request()
      .post("/api/support")
      .send({ name: "Vera Visitor", from: `vera.${h.runId}@test.com`, replyTo: `vera.${h.runId}@test.com`, area: "Contact page: Accounts", severity: "med", body: "Do you run Saturday sessions?" });
    expect(res.status).toBe(201);
    const mail = await waitForMail(chief.email, /New message from Vera Visitor/);
    expect(mail).toBeTruthy();
    expect(mail.replyTo).toBe(`vera.${h.runId}@test.com`);
    expect(mail.text).toContain("Do you run Saturday sessions?");
    expect(mail.text).toContain(res.body.item.ref);
  });

  test("SUPPORT_EMAIL sends them to a chosen inbox instead", async () => {
    process.env.SUPPORT_EMAIL = `inbox.${h.runId}@test.com`;
    await h.request().post("/api/support").send({ name: "Kim", from: `kim.${h.runId}@test.com`, area: "Keep me posted", body: "Please let me know." });
    delete process.env.SUPPORT_EMAIL;
    expect(await waitForMail(`inbox.${h.runId}@test.com`, /Keep me posted/)).toBeTruthy();
  });

  test("inviting a carer emails them a link to join", async () => {
    const parentToken = (await h.request().post("/api/auth/login").send({ email: parent.email, password: "Brand-New-Pass-1" })).body.token;
    const res = await h.as(parentToken).post("/api/family", { id: `fam-mail-${h.runId}`, name: "Nan", email: `nan.${h.runId}@test.com` });
    expect(res.status).toBe(201);
    expect(res.body.emailed).toBe(true);
    const mail = latestTo(`nan.${h.runId}@test.com`, /invited you/);
    expect(mail.text).toMatch(/\?view=create&invite=nan\./);
    expect(mail.text).toContain(res.body.item.ref);
  });

  test("an administrator adds another; they set a password from the email, then sign in with an emailed code", async () => {
    const newcomer = `deputy.${h.runId}@test.com`;
    const res = await h.as(chiefToken).post("/api/admin/admins", { email: newcomer, name: "Dee Deputy" });
    expect(res.status).toBe(201);
    const mail = latestTo(newcomer, /added as an administrator/);
    const token = mail.text.match(/#reset=([0-9a-f]{64})/)[1];

    const set = await h.request().post("/api/auth/reset-password").send({ token, password: "Deputy-Pass-12345" });
    expect(set.body.signIn).toBe(true);
    const started = await h.request().post("/api/auth/login").send({ email: newcomer, password: "Deputy-Pass-12345", role: "admin" });
    expect(started.body.via).toBe("email");

    expect((await h.as(chiefToken).post("/api/admin/admins", { email: newcomer })).status).toBe(409);
    expect((await h.as(chiefToken).post("/api/admin/admins", { email: parent.email })).status).toBe(409);
    const parentToken = (await h.request().post("/api/auth/login").send({ email: parent.email, password: "Brand-New-Pass-1" })).body.token;
    expect((await h.as(parentToken).post("/api/admin/admins", { email: `x.${h.runId}@test.com` })).status).toBe(403);

    process.env.MAIL_PROVIDER = "";
    const off = await h.as(chiefToken).post("/api/admin/admins", { email: `later.${h.runId}@test.com` });
    process.env.MAIL_PROVIDER = "log";
    expect(off.status).toBe(503);
    expect(off.body.code).toBe("EMAIL_OFF");
  });
});
