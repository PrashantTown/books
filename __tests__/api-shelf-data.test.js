const { harness } = require("./helpers/apiHarness");
const Child = require("../src/models/Child");

const h = harness("shelf");

let parent;
let token;
let other;
let otherToken;
let admin;
let adminToken;

beforeAll(async () => {
  await h.connect();
  parent = await h.makeUser("sarah");
  token = await h.login(parent);
  other = await h.makeUser("marcus");
  otherToken = await h.login(other);
  admin = await h.makeUser("shelfadmin", "admin");
  adminToken = await h.login(admin);
}, 30000);

afterAll(async () => {
  await h.cleanup();
}, 30000);

describe("Family shelf", () => {
  test("starts empty with a welcome line in the activity feed", async () => {
    const res = await h.as(token).get("/api/shelf");
    expect(res.status).toBe(200);
    const { shelf } = res.body;
    expect(shelf.parent.email).toBe(parent.email);
    expect(shelf.children).toEqual([]);
    expect(shelf.books).toEqual([]);
    expect(shelf.activity[0].text).toMatch(/Account created/);
    expect(shelf.bedtime).toEqual({ start: "19:30", winddown: 15, autoSwitch: true });
  });

  test("applies a batch of changes and returns the shelf in frontend shape", async () => {
    const res = await h.as(token).patch("/api/shelf", {
      ops: [
        { op: "put", type: "child", id: "c1", data: { id: "c1", name: "Harry", age: 6, band: "5–7", colour: "#B3402E", likes: ["picture", "early"] } },
        { op: "put", type: "child", id: "c2", data: { id: "c2", name: "Leo", age: null, band: "7–9", colour: "#0A6280", likes: [] } },
        {
          op: "put",
          type: "book",
          id: "b1",
          data: { id: "b1", title: "The Gruffalo", author: "Julia Donaldson", category: "picture", ages: "3–5", status: "reading", who: ["c1"], spine: "#0D3B32", cover: "", pages: 32, page: 18, started: "2026-10-16", notes: "Voices!", sourceId: "x9" },
        },
        { op: "put", type: "wish", id: "w1", data: { id: "w1", title: "Where the Wild Things Are", author: "Maurice Sendak", status: "toread", who: [], notes: "" } },
        { op: "put", type: "session", id: "s1", data: { id: "s1", bookId: "b1", childId: "c1", date: "2026-10-18", minutes: 15, page: 18 } },
        { op: "put", type: "session", id: "s2", data: { id: "s2", bookId: "b1", childId: null, date: "2026-10-17", minutes: 10 } },
      ],
      order: { children: ["c1", "c2"], books: ["b1"], wishlist: ["w1"], sessions: ["s1", "s2"] },
      meta: {
        colour: "#123F5B",
        activity: [{ text: "Added The Gruffalo", at: 1700000000000 }],
        bedtime: { start: "19:00", winddown: 20, autoSwitch: false },
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.rejected).toEqual([]);
    const { shelf } = res.body;

    expect(shelf.children.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(shelf.children[1].age).toBeNull();
    expect(shelf.books[0]).toMatchObject({ id: "b1", title: "The Gruffalo", pages: 32, page: 18, who: ["c1"], sourceId: "x9" });
    expect(shelf.books[0]).not.toHaveProperty("rating");
    expect(shelf.wishlist[0]).toMatchObject({ id: "w1", title: "Where the Wild Things Are" });
    expect(shelf.sessions[1]).toEqual({ id: "s2", bookId: "b1", childId: null, date: "2026-10-17", minutes: 10 });
    expect(shelf.parent.colour).toBe("#123F5B");
    expect(shelf.bedtime).toEqual({ start: "19:00", winddown: 20, autoSwitch: false });
    expect(shelf.activity).toEqual([{ text: "Added The Gruffalo", at: 1700000000000 }]);
  });

  test("shelf children are real Child records visible through /api/children", async () => {
    const res = await h.as(token).get("/api/children");
    expect(res.status).toBe(200);
    expect(res.body.children.map((c) => c.name).sort()).toEqual(["Harry", "Leo"]);
    expect(await Child.countDocuments({ parent: parent._id, clientId: "c1" })).toBe(1);
  });

  test("updates, moves between lists and deletes, reporting bad changes without blocking good ones", async () => {
    const res = await h.as(token).patch("/api/shelf", {
      ops: [
        { op: "put", type: "book", id: "b1", data: { title: "The Gruffalo", status: "read", rating: 5, finished: "2026-10-19" } },
        { op: "delete", type: "wish", id: "w1" },
        { op: "put", type: "book", id: "w1", data: { title: "Where the Wild Things Are", status: "toread" } },
        { op: "put", type: "book", id: "bad1", data: { title: "" } },
        { op: "put", type: "session", id: "s3", data: { date: "yesterday" } },
        { op: "delete", type: "child", id: "c2" },
      ],
      order: { books: ["w1", "b1"] },
    });

    expect(res.status).toBe(200);
    expect(res.body.rejected.map((r) => r.id)).toEqual(["bad1", "s3"]);
    const { shelf } = res.body;
    expect(shelf.books.map((b) => b.id)).toEqual(["w1", "b1"]);
    expect(shelf.books[1]).toMatchObject({ status: "read", rating: 5, finished: "2026-10-19" });
    expect(shelf.wishlist).toEqual([]);
    expect(shelf.children.map((c) => c.id)).toEqual(["c1"]);
  });

  test("keeps each family's shelf private", async () => {
    const res = await h.as(otherToken).get("/api/shelf");
    expect(res.body.shelf.books).toEqual([]);

    await h.as(otherToken).patch("/api/shelf", { ops: [{ op: "delete", type: "book", id: "b1" }] });
    const mine = await h.as(token).get("/api/shelf");
    expect(mine.body.shelf.books.some((b) => b.id === "b1")).toBe(true);

    expect((await h.as(adminToken).get("/api/shelf")).status).toBe(403);
  });

  test("REST endpoints for books and the reading log", async () => {
    const created = await h.as(token).post("/api/shelf/books?list=wishlist", { id: "w9", title: "Matilda", author: "Roald Dahl" });
    expect(created.status).toBe(201);
    expect((await h.as(token).get("/api/shelf/books?list=wishlist")).body.books.map((b) => b.id)).toContain("w9");
    expect((await h.as(token).put("/api/shelf/books/w9?list=wishlist", { title: "Matilda (new edition)" })).body.book.title).toBe("Matilda (new edition)");
    expect((await h.as(token).put("/api/shelf/books/nope?list=wishlist", { title: "x" })).status).toBe(404);
    expect((await h.as(token).delete("/api/shelf/books/w9?list=wishlist")).status).toBe(200);

    const logged = await h.as(token).post("/api/shelf/sessions", { id: "s9", bookId: "b1", childId: "c1", date: "2026-10-19", minutes: 25 });
    expect(logged.status).toBe(201);
    const list = await h.as(token).get("/api/shelf/sessions?from=2026-10-19&childId=c1");
    expect(list.body.sessions.map((s) => s.id)).toEqual(["s9"]);
    expect((await h.as(token).delete("/api/shelf/sessions/s9")).status).toBe(200);
  });
});

describe("Per-user data and platform settings", () => {
  test("stores and returns each allowed key, and rejects unknown keys", async () => {
    const put = await h.as(token).put("/api/me/data/prefs", { value: { bigText: true, startTab: "library" } });
    expect(put.status).toBe(200);
    expect((await h.as(token).get("/api/me/data/prefs")).body.value).toEqual({ bigText: true, startTab: "library" });

    await h.as(token).put("/api/me/data/genres", { value: { genres: ["adventure"], skipped: false, at: 1 } });
    const all = await h.as(token).get("/api/me/data");
    expect(all.body.data.genres.genres).toEqual(["adventure"]);
    expect(all.body.data.kidLooks).toBeNull();

    expect((await h.as(token).put("/api/me/data/secrets", { value: {} })).status).toBe(404);
    expect((await h.as(token).put("/api/me/data/prefs", { value: "nope" })).status).toBe(400);
    expect((await h.as(otherToken).get("/api/me/data/prefs")).body.value).toBeNull();
  });

  test("platform rules come from the most recently saved administrator settings", async () => {
    const before = await h.as(token).get("/api/settings/platform");
    expect(before.status).toBe(200);
    expect(before.body.settings).toHaveProperty("lockAttempts");

    await h.as(adminToken).put("/api/me/data/prefs", { value: { subRetention: 30, savedAt: Date.now() + 60000 } });
    const after = await h.as(token).get("/api/settings/platform");
    expect(after.body.settings.subRetention).toBe(30);

    // A parent saving the same setting name has no effect on the platform.
    await h.as(token).put("/api/me/data/prefs", { value: { subRetention: 0, savedAt: Date.now() + 120000 } });
    expect((await h.as(token).get("/api/settings/platform")).body.settings.subRetention).toBe(30);
  });
});
