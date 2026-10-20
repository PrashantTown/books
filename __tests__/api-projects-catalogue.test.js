const { harness } = require("./helpers/apiHarness");
const Project = require("../src/models/Project");
const CatalogueBook = require("../src/models/CatalogueBook");
const Resource = require("../src/models/Resource");

// Added with the final version of the site: project tiles and pages, the
// book catalogue, shelves shared with carers, and two account helpers.

const h = harness("final");

let admin;
let adminToken;
let parent;
let parentToken;
let carer;
let carerToken;
let stranger;
let strangerToken;

beforeAll(async () => {
  await h.connect();
  admin = await h.makeUser("admin", "admin");
  adminToken = await h.login(admin);
  parent = await h.makeUser("parent");
  parentToken = await h.login(parent);
  carer = await h.makeUser("carer");
  carerToken = await h.login(carer);
  stranger = await h.makeUser("stranger");
  strangerToken = await h.login(stranger);
}, 30000);

afterAll(async () => {
  await Project.deleteMany({ clientId: new RegExp(h.runId) });
  await CatalogueBook.deleteMany({ clientId: new RegExp(h.runId) });
  await Resource.deleteMany({ clientId: new RegExp(h.runId) });
  await h.cleanup();
}, 30000);

describe("Projects", () => {
  test("anyone can read them, and the two built-in projects are always there", async () => {
    const res = await h.request().get("/api/projects");
    expect(res.status).toBe(200);
    const bySlug = Object.fromEntries(res.body.items.map((p) => [p.slug, p]));
    expect(bySlug["reading-for-pleasure"]).toMatchObject({ status: "open", builtIn: true, link: "reading-for-pleasure.html" });
    expect(bySlug["four-voices"]).toMatchObject({ status: "soon", builtIn: true });
  });

  test("administrators add and edit projects; the web address stays fixed", async () => {
    const id = `proj-${h.runId}`;
    const slug = `maths-${h.runId}`.slice(0, 40).replace(/-+$/, "");
    const made = await h.as(adminToken).put(`/api/projects/${id}`, {
      slug,
      title: "Maths at home",
      blurb: "Number games for the car and the kitchen.",
      status: "soon",
      sort: 20,
      categories: [{ id: "games", name: "Games" }, { name: "Counting songs" }, { name: "Games" }],
    });
    expect(made.status).toBe(200);
    expect(made.body.item).toMatchObject({ id, slug, status: "soon", builtIn: false });
    expect(made.body.item.categories).toEqual([
      { id: "games", name: "Games" },
      { id: "counting-songs", name: "Counting songs" },
    ]);

    const edited = await h.as(adminToken).put(`/api/projects/${id}`, { slug: "something-else", title: "Maths at home", status: "open" });
    expect(edited.body.item).toMatchObject({ slug, status: "open" });

    const listed = (await h.request().get("/api/projects")).body.items.find((p) => p.id === id);
    expect(listed.title).toBe("Maths at home");
  });

  test("checks what is saved and who saves it", async () => {
    expect((await h.as(parentToken).put(`/api/projects/p2-${h.runId}`, { slug: "x", title: "X" })).status).toBe(403);
    expect((await h.request().put(`/api/projects/p2-${h.runId}`).send({ slug: "x", title: "X" })).status).toBe(401);
    expect((await h.as(adminToken).put(`/api/projects/p2-${h.runId}`, { slug: "Not A Slug!", title: "X" })).status).toBe(400);
    expect((await h.as(adminToken).put(`/api/projects/p2-${h.runId}`, { slug: "four-voices", title: "Copy" })).status).toBe(409);
    const badLink = await h.as(adminToken).put(`/api/projects/p2-${h.runId}`, { slug: `ok-${h.runId}`.slice(0, 30), title: "X", link: "javascript:alert(1)" });
    expect(badLink.status).toBe(400);
  });

  test("built-in projects can't be deleted; others can", async () => {
    const all = (await h.request().get("/api/projects")).body.items;
    const builtIn = all.find((p) => p.slug === "four-voices");
    expect((await h.as(adminToken).delete(`/api/projects/${builtIn.id}`)).status).toBe(409);
    expect((await h.as(adminToken).delete(`/api/projects/proj-${h.runId}`)).status).toBe(200);
    expect((await h.as(adminToken).delete(`/api/projects/proj-${h.runId}`)).status).toBe(404);
  });

  test("resources say which project they belong to", async () => {
    const made = await h.as(adminToken).post("/api/resources", { id: `res-${h.runId}`, title: "Car games", project: "four-voices", state: "published" });
    expect(made.status).toBe(201);
    expect(made.body.item.project).toBe("four-voices");
    const plain = await h.as(adminToken).post("/api/resources", { id: `res2-${h.runId}`, title: "Library cards", project: "Bad Slug" });
    expect(plain.body.item.project).toBe("reading-for-pleasure");
  });
});

describe("Book catalogue", () => {
  test("families see published books; administrators also see hidden ones", async () => {
    const shown = await h.as(adminToken).put(`/api/catalogue/cat-${h.runId}`, {
      title: "Possum Magic",
      author: "Mem Fox",
      year: 1983,
      pages: 32,
      category: "picture",
      ages: "3–5",
      source: "other",
      readLink: "https://example.org/read",
      state: "published",
    });
    expect(shown.status).toBe(200);
    expect(shown.body.item).toMatchObject({ id: `cat-${h.runId}`, year: 1983, pages: 32, state: "published" });

    await h.as(adminToken).put(`/api/catalogue/cat2-${h.runId}`, { title: "Draft pick", year: 99999, state: "hidden" });

    const publicList = (await h.request().get("/api/catalogue")).body.items.map((b) => b.id);
    expect(publicList).toContain(`cat-${h.runId}`);
    expect(publicList).not.toContain(`cat2-${h.runId}`);

    const parentList = (await h.as(parentToken).get("/api/catalogue")).body.items.map((b) => b.id);
    expect(parentList).not.toContain(`cat2-${h.runId}`);

    const adminList = (await h.as(adminToken).get("/api/catalogue")).body.items;
    const hidden = adminList.find((b) => b.id === `cat2-${h.runId}`);
    expect(hidden).toMatchObject({ state: "hidden", year: null });
  });

  test("only administrators change it, and links must be https", async () => {
    expect((await h.as(parentToken).put(`/api/catalogue/cat3-${h.runId}`, { title: "Mine" })).status).toBe(403);
    expect((await h.as(adminToken).put(`/api/catalogue/cat3-${h.runId}`, { title: "" })).status).toBe(400);
    expect((await h.as(adminToken).put(`/api/catalogue/cat3-${h.runId}`, { title: "X", cover: "http://insecure.example/a.png" })).status).toBe(400);
    expect((await h.as(adminToken).delete(`/api/catalogue/cat2-${h.runId}`)).status).toBe(200);
    expect((await h.as(adminToken).delete(`/api/catalogue/cat2-${h.runId}`)).status).toBe(404);
  });
});

describe("Shelves shared with carers", () => {
  test("an accepted carer can look at the family's shelf, and loses it when access is withdrawn", async () => {
    const childId = `kid-${h.runId}`;
    const saved = await h.as(parentToken).patch("/api/shelf", {
      ops: [
        { op: "put", type: "child", id: childId, data: { name: "Ivy", band: "5–7", colour: "#0A6280" } },
        { op: "put", type: "book", id: `bk-${h.runId}`, data: { title: "Possum Magic", author: "Mem Fox", status: "reading", who: [childId], pages: 32, page: 10 } },
      ],
    });
    expect(saved.body.rejected).toEqual([]);

    expect((await h.as(carerToken).get("/api/family/shared")).body.items).toEqual([]);

    const inviteId = `fam-${h.runId}`;
    expect((await h.as(parentToken).post("/api/family", { id: inviteId, name: "Nan", email: carer.email })).status).toBe(201);
    // Invited isn't enough: the shelf appears once they accept.
    expect((await h.as(carerToken).get("/api/family/shared")).body.items).toEqual([]);
    expect((await h.as(carerToken).post(`/api/family/${inviteId}/accept`)).status).toBe(200);

    const shared = (await h.as(carerToken).get("/api/family/shared")).body.items;
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ ownerName: parent.name, ownerEmail: parent.email, linkId: inviteId });
    expect(shared[0].children.map((k) => k.name)).toEqual(["Ivy"]);
    expect(shared[0].books[0]).toMatchObject({ title: "Possum Magic", status: "reading" });

    expect((await h.as(strangerToken).get("/api/family/shared")).body.items).toEqual([]);

    expect((await h.as(parentToken).post(`/api/family/${inviteId}/withdraw`)).status).toBe(200);
    expect((await h.as(carerToken).get("/api/family/shared")).body.items).toEqual([]);
  });
});

describe("Account helpers", () => {
  test("checking the current password changes nothing", async () => {
    const right = await h.as(parentToken).post("/api/auth/verify-password", { password: h.PASSWORD });
    expect(right.body).toMatchObject({ success: true, valid: true });
    const wrong = await h.as(parentToken).post("/api/auth/verify-password", { password: "not-it" });
    expect(wrong.body.valid).toBe(false);
    expect((await h.as(parentToken).post("/api/auth/verify-password", {})).status).toBe(400);
    // Still signed in, and a wrong guess here doesn't count towards the lockout.
    expect((await h.as(parentToken).get("/api/auth/me")).status).toBe(200);
  });

  test("signing out everywhere else keeps this device signed in", async () => {
    const other = await h.login(stranger);
    const res = await h.as(strangerToken).post("/api/auth/logout-others");
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect((await h.as(other).get("/api/auth/me")).status).toBe(401);
    expect((await h.as(strangerToken).get("/api/auth/me")).status).toBe(401);
    expect((await h.as(res.body.token).get("/api/auth/me")).status).toBe(200);
  });
});
