const { harness } = require("./helpers/apiHarness");
const ShareLink = require("../src/models/ShareLink");

const h = harness("family");

let owner;
let ownerToken;
let carer;
let carerToken;
let stranger;
let strangerToken;

beforeAll(async () => {
  await h.connect();
  owner = await h.makeUser("owner");
  ownerToken = await h.login(owner);
  carer = await h.makeUser("grandma");
  carerToken = await h.login(carer);
  stranger = await h.makeUser("stranger");
  strangerToken = await h.login(stranger);
}, 30000);

afterAll(async () => {
  await h.cleanup();
}, 30000);

describe("Carer invitations", () => {
  test("invite, see it from both sides, accept as the invited person", async () => {
    const sent = await h.as(ownerToken).post("/api/family", { id: `fam-${h.runId}`, name: "Grandma", email: carer.email });
    expect(sent.status).toBe(201);
    expect(sent.body.item).toMatchObject({ owner: owner.email, email: carer.email, state: "invited", incoming: false });

    expect((await h.as(ownerToken).post("/api/family", { name: "Again", email: carer.email })).status).toBe(409);
    expect((await h.as(ownerToken).post("/api/family", { name: "Me", email: owner.email })).status).toBe(400);

    const incoming = (await h.as(carerToken).get("/api/family")).body.items.find((r) => r.id === `fam-${h.runId}`);
    expect(incoming.incoming).toBe(true);

    expect((await h.as(strangerToken).post(`/api/family/fam-${h.runId}/accept`)).status).toBe(404);
    const accepted = await h.as(carerToken).post(`/api/family/fam-${h.runId}/accept`);
    expect(accepted.body.item.state).toBe("accepted");
    expect((await h.as(carerToken).post(`/api/family/fam-${h.runId}/accept`)).status).toBe(409);
  });
});

describe("Chat", () => {
  test("shelf chats need an accepted invitation", async () => {
    const blocked = await h.as(ownerToken).post("/api/chat/threads", {
      id: `th-s${h.runId}`,
      kind: "shelf",
      key: `shelf:${owner.email}:x`,
      members: [`mail:${owner.email}`, `mail:${stranger.email}`],
    });
    expect(blocked.status).toBe(403);

    const thread = await h.as(ownerToken).post("/api/chat/threads", {
      id: `th-c${h.runId}`,
      kind: "shelf",
      key: `shelf:${owner.email}:fam-${h.runId}`,
      title: "Grandma",
      members: [`mail:${owner.email}`, `mail:${carer.email}`],
      names: { [`mail:${owner.email}`]: "Sarah", [`mail:${carer.email}`]: "Grandma" },
    });
    expect(thread.status).toBe(201);

    // Opening the same key again returns the same thread.
    const again = await h.as(carerToken).post("/api/chat/threads", {
      id: `th-other${h.runId}`,
      kind: "shelf",
      key: `shelf:${owner.email}:fam-${h.runId}`,
      members: [`mail:${carer.email}`, `mail:${owner.email}`],
    });
    expect(again.body.item.id).toBe(`th-c${h.runId}`);
  });

  test("members send messages as themselves only, and keep their own read markers", async () => {
    const sent = await h.as(ownerToken).post(`/api/chat/threads/th-c${h.runId}/messages`, {
      id: `m-1${h.runId}`,
      from: `mail:${owner.email}`,
      body: "We started Charlotte's Web tonight!",
    });
    expect(sent.status).toBe(201);

    expect((await h.as(carerToken).post(`/api/chat/threads/th-c${h.runId}/messages`, { from: `mail:${owner.email}`, body: "pretending" })).status).toBe(403);
    expect((await h.as(strangerToken).post(`/api/chat/threads/th-c${h.runId}/messages`, { body: "hello?" })).status).toBe(404);

    const reply = await h.as(carerToken).post(`/api/chat/threads/th-c${h.runId}/messages`, { id: `m-2${h.runId}`, body: "Lovely! Which chapter?" });
    expect(reply.body.item.from).toBe(`mail:${carer.email}`);

    await h.as(carerToken).put(`/api/chat/threads/th-c${h.runId}/read`, { member: `mail:${carer.email}`, at: Date.now() });
    expect((await h.as(carerToken).put(`/api/chat/threads/th-c${h.runId}/read`, { member: `mail:${owner.email}` })).status).toBe(403);

    const carerView = (await h.as(carerToken).get("/api/chat")).body.chat;
    expect(carerView.msgs[`th-c${h.runId}`].map((m) => m.id)).toEqual([`m-1${h.runId}`, `m-2${h.runId}`]);
    expect(Object.keys(carerView.reads)).toEqual([`th-c${h.runId}|mail:${carer.email}`]);

    const strangerView = (await h.as(strangerToken).get("/api/chat")).body.chat;
    expect(strangerView.threads).toEqual([]);
  });

  test("family chats are between a parent and their own children's profiles", async () => {
    const kid = `kid:${owner.email}:c1`;
    const thread = await h.as(ownerToken).post("/api/chat/threads", {
      id: `th-f${h.runId}`,
      kind: "family",
      key: `family:${owner.email}:c1`,
      account: owner.email,
      members: [`mail:${owner.email}`, kid],
      names: { [kid]: "Harry" },
    });
    expect(thread.status).toBe(201);

    const asKid = await h.as(ownerToken).post(`/api/chat/threads/th-f${h.runId}/messages`, { from: kid, body: "Can we read the dragon book?" });
    expect(asKid.status).toBe(201);
    expect(asKid.body.item.name).toBe("Harry");

    const foreignKid = await h.as(strangerToken).post("/api/chat/threads", {
      kind: "family",
      account: owner.email,
      members: [`mail:${stranger.email}`, kid],
    });
    expect(foreignKid.status).toBe(403);

    expect((await h.as(carerToken).get("/api/chat")).body.chat.threads.map((t) => t.id)).not.toContain(`th-f${h.runId}`);
  });

  test("changing your email keeps your chats", async () => {
    const newEmail = h.email("owner-renamed");
    const res = await h.as(ownerToken).patch("/api/auth/me", { email: newEmail });
    expect(res.status).toBe(200);

    const view = (await h.as(ownerToken).get("/api/chat")).body.chat;
    const family = view.threads.find((t) => t.id === `th-f${h.runId}`);
    expect(family.account).toBe(newEmail);
    expect(family.members).toContain(`kid:${newEmail}:c1`);
    expect(view.msgs[`th-f${h.runId}`][0].from).toBe(`kid:${newEmail}:c1`);

    const shelfThread = view.threads.find((t) => t.id === `th-c${h.runId}`);
    expect(shelfThread.members).toContain(`mail:${newEmail}`);
    owner.email = newEmail;
  });
});

describe("Wishlist share links", () => {
  test("owner creates a link; anyone with the token can open it until it expires or is turned off", async () => {
    const put = await h.as(ownerToken).put("/api/share/mine", {
      token: `tok${h.runId}`.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30),
      scope: "link",
      initials: true,
      expiry: "7",
      ownerName: "Sarah",
      items: [{ title: "Matilda", author: "Roald Dahl", catName: "Chapter books", ages: "7–9", spine: "#0A6280", forNames: ["H."] }],
    });
    expect(put.status).toBe(200);
    const { token } = put.body.item;
    expect(put.body.item.expires - put.body.item.created).toBe(7 * 864e5);

    const opened = await h.request().get(`/api/share/${token}`);
    expect(opened.status).toBe(200);
    expect(opened.body.item.items[0].title).toBe("Matilda");
    expect(opened.body.item).not.toHaveProperty("owner");

    await ShareLink.updateOne({ token }, { $set: { expires: new Date(Date.now() - 1000) } });
    expect((await h.request().get(`/api/share/${token}`)).status).toBe(410);

    expect((await h.as(ownerToken).delete("/api/share/mine")).status).toBe(200);
    expect((await h.request().get(`/api/share/${token}`)).status).toBe(404);
  });
});
