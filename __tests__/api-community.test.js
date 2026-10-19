const { harness } = require("./helpers/apiHarness");
const Notification = require("../src/models/Notification");

const h = harness("community");

let admin;
let adminToken;
let alice;
let aliceToken;
let bob;
let bobToken;

// Platform rules are the newest administrator settings, so this file's admin
// saves them with a far-future time to control moderation in these tests.
const setRules = (rules) =>
  h.as(adminToken).put("/api/me/data/prefs", { value: { ...rules, savedAt: Date.now() + 1e9 } });

beforeAll(async () => {
  await h.connect();
  admin = await h.makeUser("modadmin", "admin");
  adminToken = await h.login(admin);
  alice = await h.makeUser("alice");
  aliceToken = await h.login(alice);
  bob = await h.makeUser("bob");
  bobToken = await h.login(bob);
}, 30000);

afterAll(async () => {
  await h.cleanup();
}, 30000);

describe("Moderation rules", () => {
  test("holds everything for review by default, and lets clean posts through when told to", async () => {
    await setRules({ holdAll: true, flagNames: true, linkAllow: true });
    const held = await h.as(aliceToken).post("/api/community/board", { id: `bd-held${h.runId}`, body: "Any tips for reluctant readers aged seven?" });
    expect(held.status).toBe(201);
    expect(held.body.item.state).toBe("pending");

    await setRules({ holdAll: false, flagNames: true, linkAllow: true });
    const clean = await h.as(aliceToken).post("/api/community/board", { id: `bd-clean${h.runId}`, body: "We loved the library storytime this week." });
    expect(clean.body.item.state).toBe("published");
    expect(clean.body.item.decidedBy).toBe("Automatic");

    const named = await h.as(aliceToken).post("/api/community/board", { id: `bd-named${h.runId}`, body: "Ask Jenny Smith about the reading club." });
    expect(named.body.item.state).toBe("pending");

    const badLink = await h.as(aliceToken).post("/api/community/board", { id: `bd-link${h.runId}`, body: "Great list here https://example.com/books for everyone" });
    expect(badLink.body.item.state).toBe("pending");

    const goodLink = await h.as(aliceToken).post("/api/community/board", { id: `bd-gl${h.runId}`, body: "Great list here https://www.readingrockets.org/books for everyone" });
    expect(goodLink.body.item.state).toBe("published");
  });
});

describe("Message board", () => {
  test("others see only published posts; owners see their own; admins see all", async () => {
    const bobView = await h.as(bobToken).get("/api/community/board");
    const ids = bobView.body.items.map((p) => p.id);
    expect(ids).toContain(`bd-clean${h.runId}`);
    expect(ids).not.toContain(`bd-held${h.runId}`);

    const aliceView = await h.as(aliceToken).get("/api/community/board");
    expect(aliceView.body.items.map((p) => p.id)).toContain(`bd-held${h.runId}`);
    const own = aliceView.body.items.find((p) => p.id === `bd-held${h.runId}`);
    expect(own.owner).toBe(alice.email);
    expect(own.from).toBe(alice.name);

    const adminView = await h.as(adminToken).get("/api/community/board");
    expect(adminView.body.items.map((p) => p.id)).toContain(`bd-held${h.runId}`);
  });

  test("administrators publish and remove (with a reason); parents can't", async () => {
    expect((await h.as(bobToken).patch(`/api/community/board/bd-held${h.runId}/moderation`, { state: "published" })).status).toBe(403);
    expect((await h.as(adminToken).patch(`/api/community/board/bd-held${h.runId}/moderation`, { state: "removed" })).status).toBe(400);

    const pub = await h.as(adminToken).patch(`/api/community/board/bd-held${h.runId}/moderation`, { state: "published" });
    expect(pub.body.item).toMatchObject({ state: "published", decidedBy: admin.email });

    const removed = await h.as(adminToken).patch(`/api/community/board/bd-named${h.runId}/moderation`, { state: "removed", reason: "It names a person" });
    expect(removed.body.item).toMatchObject({ state: "removed", reason: "It names a person" });
  });

  test("replies attach to a post, retries are idempotent and owners can delete", async () => {
    const reply = await h.as(bobToken).post("/api/community/board", { id: `bd-reply${h.runId}`, body: "Graphic novels worked for us!", parentId: `bd-held${h.runId}` });
    expect(reply.status).toBe(201);
    expect(reply.body.item.parentId).toBe(`bd-held${h.runId}`);

    const retry = await h.as(bobToken).post("/api/community/board", { id: `bd-reply${h.runId}`, body: "Graphic novels worked for us!", parentId: `bd-held${h.runId}` });
    expect(retry.status).toBe(200);

    expect((await h.as(aliceToken).post("/api/community/board", { id: `bd-reply${h.runId}`, body: "Trying to reuse an id" })).status).toBe(409);
    expect((await h.as(aliceToken).post("/api/community/board", { body: "too short" })).status).toBe(400);
    expect((await h.as(aliceToken).delete(`/api/community/board/bd-reply${h.runId}`)).status).toBe(403);
    expect((await h.as(bobToken).delete(`/api/community/board/bd-reply${h.runId}`)).status).toBe(200);
  });
});

describe("Parents' book reviews", () => {
  test("one review per book per parent, matched by normalised title and author", async () => {
    await setRules({ holdAll: true });
    const first = await h.as(aliceToken).post("/api/community/reviews", {
      id: `rv-a${h.runId}`,
      bookTitle: "Goodnight Moon",
      bookAuthor: "Margaret Wise Brown",
      rating: 4,
      body: "Short and soothing — a bedtime regular.",
    });
    expect(first.status).toBe(201);
    expect(first.body.item.book).toBe("goodnight moon|margaret wise brown");
    expect(first.body.item.state).toBe("pending");

    const dupe = await h.as(aliceToken).post("/api/community/reviews", {
      id: `rv-b${h.runId}`,
      bookTitle: "GOODNIGHT  MOON!",
      bookAuthor: "Margaret Wise Brown",
      rating: 2,
      body: "Trying to review it twice.",
    });
    expect(dupe.status).toBe(409);

    expect((await h.as(aliceToken).post("/api/community/reviews", { bookTitle: "X", rating: 9, body: "Out of range rating" })).status).toBe(400);
  });

  test("editing sends it back to review; admins decide; others see it once published", async () => {
    await h.as(adminToken).patch(`/api/community/reviews/rv-a${h.runId}/moderation`, { state: "published" });
    let bobView = await h.as(bobToken).get(`/api/community/reviews?book=${encodeURIComponent("goodnight moon|margaret wise brown")}`);
    expect(bobView.body.items.map((r) => r.id)).toContain(`rv-a${h.runId}`);

    const edited = await h.as(aliceToken).patch(`/api/community/reviews/rv-a${h.runId}`, { rating: 5, body: "Even better the second time round." });
    expect(edited.body.item).toMatchObject({ rating: 5, state: "pending" });
    expect(edited.body.item.edited).toBeTruthy();

    bobView = await h.as(bobToken).get("/api/community/reviews");
    expect(bobView.body.items.map((r) => r.id)).not.toContain(`rv-a${h.runId}`);

    expect((await h.as(bobToken).patch(`/api/community/reviews/rv-a${h.runId}`, { rating: 1 })).status).toBe(403);
  });
});

describe("Suggestions and resources", () => {
  test("parents suggest, admins approve, approved ones are visible to everyone", async () => {
    const s = await h.as(aliceToken).post("/api/community/suggestions", {
      id: `psub-${h.runId}`,
      title: "Library storytime",
      body: "Saturdays at 10",
      link: "https://www.slq.qld.gov.au/",
      category: "picture",
      ages: "3–5",
    });
    expect(s.status).toBe(201);
    expect(s.body.item.state).toBe("pending");
    expect((await h.as(aliceToken).post("/api/community/suggestions", { title: "Bad link", link: "javascript:alert(1)" })).status).toBe(400);

    expect((await h.as(bobToken).get("/api/community/suggestions")).body.items.map((i) => i.id)).not.toContain(`psub-${h.runId}`);
    await h.as(adminToken).patch(`/api/community/suggestions/psub-${h.runId}/moderation`, { state: "approved" });
    expect((await h.as(bobToken).get("/api/community/suggestions")).body.items.map((i) => i.id)).toContain(`psub-${h.runId}`);

    const rejected = await h.as(adminToken).patch(`/api/community/suggestions/psub-${h.runId}/moderation`, { state: "rejected", reason: "Duplicate" });
    expect(rejected.body.item.reason).toBe("Duplicate");
  });

  test("only administrators write resources; parents see published ones", async () => {
    expect((await h.as(aliceToken).post("/api/resources", { title: "Nope" })).status).toBe(403);

    const draft = await h.as(adminToken).post("/api/resources", { id: `postd${h.runId}`, title: "Draft guide", body: "WIP", state: "draft" });
    const live = await h.as(adminToken).post("/api/resources", { id: `postp${h.runId}`, title: "Ten minutes counts", body: "Short reads", state: "published", link: "https://raisingchildren.net.au/" });
    expect(draft.status).toBe(201);
    expect(live.body.item.by).toBe(admin.email);

    const parentIds = (await h.as(aliceToken).get("/api/resources")).body.items.map((r) => r.id);
    expect(parentIds).toContain(`postp${h.runId}`);
    expect(parentIds).not.toContain(`postd${h.runId}`);

    const edited = await h.as(adminToken).put(`/api/resources/postd${h.runId}`, { state: "published" });
    expect(edited.body.item.state).toBe("published");
    expect((await h.as(adminToken).delete(`/api/resources/postd${h.runId}`)).status).toBe(200);
    expect((await h.as(adminToken).delete(`/api/resources/postp${h.runId}`)).status).toBe(200);
  });
});

describe("Support reports", () => {
  test("visitors can use the contact form; the admins are told", async () => {
    const res = await h.request().post("/api/support").send({
      id: `tkpub${h.runId}`,
      name: "Visitor",
      from: h.email("visitor"),
      replyTo: h.email("visitor"),
      body: "Do you run sessions on weekends?",
    });
    expect(res.status).toBe(201);
    expect(res.body.item.source).toBe("public");
    expect(res.body.item.ref).toMatch(/^PTG-/);
    expect(await Notification.exists({ to: "admin::*", tag: `report-tkpub${h.runId}` })).toBeTruthy();

    expect((await h.request().post("/api/support").send({ body: "No email given here" })).status).toBe(400);
  });

  test("signed-in reports belong to the reporter; admins see and update all", async () => {
    const res = await h.as(aliceToken).post("/api/support", {
      id: `tkp${h.runId}`,
      ref: "PTG-A1B2C3",
      area: "The library",
      severity: "high",
      body: "Books disappear when I add a fourth child.",
      source: "admin",
    });
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({ source: "parent", from: alice.email, ref: "PTG-A1B2C3" });

    expect((await h.as(bobToken).get("/api/support")).body.items.map((t) => t.id)).not.toContain(`tkp${h.runId}`);
    expect((await h.as(aliceToken).get("/api/support")).body.items.map((t) => t.id)).toContain(`tkp${h.runId}`);

    expect((await h.as(aliceToken).patch(`/api/support/tkp${h.runId}`, { state: "closed" })).status).toBe(403);
    const updated = await h.as(adminToken).patch(`/api/support/tkp${h.runId}`, { state: "progress" });
    expect(updated.body.item.state).toBe("progress");
  });

  test("screenshots: owner uploads, owner and admins view, size and type are checked", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

    expect((await h.as(bobToken).post(`/api/support/tkp${h.runId}/screenshot`, { dataUrl })).status).toBe(403);
    expect((await h.as(aliceToken).post(`/api/support/tkp${h.runId}/screenshot`, { dataUrl: "data:text/html;base64,PGI+aGk8L2I+" })).status).toBe(400);

    const up = await h.as(aliceToken).post(`/api/support/tkp${h.runId}/screenshot`, { dataUrl, name: "bug.png" });
    expect(up.status).toBe(201);
    expect(up.body.item.shot).toMatchObject({ name: "bug.png", type: "image/png", size: png.length });

    const viewed = await h.as(adminToken).get(`/api/support/tkp${h.runId}/screenshot`);
    expect(viewed.status).toBe(200);
    expect(viewed.headers["content-type"]).toMatch(/image\/png/);
    expect(Buffer.compare(viewed.body, png)).toBe(0);

    expect((await h.as(bobToken).get(`/api/support/tkp${h.runId}/screenshot`)).status).toBe(403);
    expect((await h.as(aliceToken).delete(`/api/support/tkp${h.runId}/screenshot`)).body.item.shot).toBeNull();
  });
});

describe("Notifications", () => {
  test("who may send to whom", async () => {
    expect((await h.as(aliceToken).post("/api/notifications", { to: `parent::${alice.email}`, title: "Note to self" })).status).toBe(201);
    expect((await h.as(aliceToken).post("/api/notifications", { to: "admin::*", title: "Please look at my post" })).status).toBe(201);
    expect((await h.as(aliceToken).post("/api/notifications", { to: `parent::${bob.email}`, title: "Hi Bob" })).status).toBe(403);
    expect((await h.as(aliceToken).post("/api/notifications", { to: "parent::*", title: "Everyone!" })).status).toBe(403);
    expect((await h.as(adminToken).post("/api/notifications", { to: `parent::${bob.email}`, title: "Your post was published", tag: `t${h.runId}` })).status).toBe(201);
  });

  test("identical unread notifications merge into one with a count", async () => {
    const tag = `merge${h.runId}`;
    await h.as(adminToken).post("/api/notifications", { to: `parent::${bob.email}`, title: "Reminder", tag });
    const second = await h.as(adminToken).post("/api/notifications", { to: `parent::${bob.email}`, title: "Reminder", tag });
    expect(second.body.item.count).toBe(2);
    expect(await Notification.countDocuments({ tag })).toBe(1);
  });

  test("read and dismissed state is per person for broadcasts", async () => {
    const other = await h.makeUser("modadmin2", "admin");
    const otherToken = await h.login(other);
    const sent = await h.as(aliceToken).post("/api/notifications", { to: "admin::*", title: `Broadcast ${h.runId}`, tag: `b${h.runId}` });
    const id = sent.body.item.id;

    await h.as(adminToken).post(`/api/notifications/${id}/read`);
    const mine = (await h.as(adminToken).get("/api/notifications")).body.items.find((n) => n.id === id);
    const theirs = (await h.as(otherToken).get("/api/notifications")).body.items.find((n) => n.id === id);
    expect(mine.read).toBe(true);
    expect(theirs.read).toBe(false);

    await h.as(adminToken).delete(`/api/notifications/${id}`);
    expect((await h.as(adminToken).get("/api/notifications")).body.items.some((n) => n.id === id)).toBe(false);
    expect((await h.as(otherToken).get("/api/notifications")).body.items.some((n) => n.id === id)).toBe(true);

    // Parents never see admin broadcasts.
    expect((await h.as(bobToken).get("/api/notifications")).body.items.some((n) => n.id === id)).toBe(false);
  });
});

describe("Activity log", () => {
  test("anyone signed in can add entries as themselves; only admins read them", async () => {
    const add = await h.as(aliceToken).post("/api/audit", { id: `log${h.runId}`, kind: "content", what: "Posted to the message board", who: "someone-else@example.com" });
    expect(add.status).toBe(201);
    expect(add.body.item.who).toBe(alice.email);

    expect((await h.as(aliceToken).get("/api/audit")).status).toBe(403);
    const list = await h.as(adminToken).get("/api/audit?limit=2000");
    expect(list.body.items.map((e) => e.id)).toContain(`log${h.runId}`);
  });
});
