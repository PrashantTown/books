const Child = require("../models/Child");
const User = require("../models/User");
const ShelfBook = require("../models/ShelfBook");
const ReadingLog = require("../models/ReadingLog");
const FamilyProfile = require("../models/FamilyProfile");
const { isClientId, isObjectId, text, hasUnsafeKeys } = require("../utils/validate");

/**
 * The family shelf: a parent's children, their library, wishlist, reading
 * log, recent activity and bedtime routine, in the shape the frontend uses.
 *
 *   GET   /api/shelf          the whole shelf
 *   PATCH /api/shelf          apply a batch of changes (what the frontend sends)
 *   plus REST endpoints for books and reading-log entries (see routes).
 *
 * Children are stored in the existing Child collection, so they also show up
 * in /api/children.
 */

const LIMITS = { children: 30, books: 5000, sessions: 20000, activity: 12 };

const BOOK_FIELDS = ["title", "author", "category", "ages", "status", "who", "spine", "cover", "pages", "page", "rating", "started", "finished", "added", "notes"];
const SESSION_FIELDS = ["bookId", "childId", "date", "minutes", "page"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

class OpError extends Error {}

/* ---------------------------------------------------------- serialising */

const childOut = (c) => ({
  id: c.clientId || String(c._id),
  name: c.name,
  age: c.age === undefined ? null : c.age,
  band: c.band,
  colour: c.colour,
  likes: c.likes || [],
});

const bookOut = (b) => {
  const out = {
    ...(b.extra && typeof b.extra === "object" ? b.extra : {}),
    id: b.clientId,
    title: b.title,
    author: b.author,
    category: b.category,
    ages: b.ages,
    status: b.status,
    who: b.who || [],
    spine: b.spine,
    cover: b.cover,
    notes: b.notes,
  };
  for (const key of ["pages", "page", "rating", "started", "finished", "added"]) {
    if (b[key] !== null && b[key] !== undefined) out[key] = b[key];
  }
  return out;
};

const sessionOut = (s) => {
  const out = {
    ...(s.extra && typeof s.extra === "object" ? s.extra : {}),
    id: s.clientId,
    bookId: s.bookId,
    childId: s.childId === undefined ? null : s.childId,
    date: s.date,
    minutes: s.minutes,
  };
  if (s.page !== null && s.page !== undefined) out.page = s.page;
  return out;
};

const getProfile = async (user) => {
  let profile = await FamilyProfile.findOne({ user: user._id });
  if (!profile) {
    profile = await FamilyProfile.create({
      user: user._id,
      activity: [{ text: "Account created. Add a reading profile to begin.", at: Date.now() }],
    });
  }
  return profile;
};

const buildShelf = async (user) => {
  const [profile, children, books, sessions] = await Promise.all([
    getProfile(user),
    Child.find({ parent: user._id }).sort({ position: 1, createdAt: 1 }),
    ShelfBook.find({ owner: user._id }).sort({ position: 1, createdAt: -1 }),
    ReadingLog.find({ owner: user._id }).sort({ position: 1, date: -1 }),
  ]);

  return {
    parent: { name: user.name, email: user.email, colour: profile.colour },
    children: children.map(childOut),
    books: books.filter((b) => b.list === "library").map(bookOut),
    wishlist: books.filter((b) => b.list === "wishlist").map(bookOut),
    sessions: sessions.map(sessionOut),
    activity: (profile.activity || []).map((a) => ({ text: a.text, at: a.at })),
    bedtime: {
      start: profile.bedtime && profile.bedtime.start ? profile.bedtime.start : "19:30",
      winddown: profile.bedtime && profile.bedtime.winddown != null ? profile.bedtime.winddown : 15,
      autoSwitch: !profile.bedtime || profile.bedtime.autoSwitch !== false,
    },
  };
};

/* ---------------------------------------------------------- validating */

const intOrNull = (value, min, max, field) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new OpError(`${field} must be a number from ${min} to ${max}`);
  return Math.floor(n);
};

const dateOrNull = (value, field) => {
  if (value === null || value === undefined || value === "") return null;
  if (!DATE.test(String(value))) throw new OpError(`${field} must be a YYYY-MM-DD date`);
  return String(value);
};

const extraFrom = (data, known) => {
  const extra = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "id" || known.includes(key)) continue;
    extra[key] = value;
  }
  if (JSON.stringify(extra).length > 20000) throw new OpError("Too much extra data on one record");
  if (hasUnsafeKeys(extra)) throw new OpError("Field names can't start with $ or contain dots");
  return extra;
};

const childFields = (data) => {
  const name = text(data.name, 80);
  if (!name) throw new OpError("A child needs a name");
  const band = text(data.band, 20);
  if (!band) throw new OpError("A child needs an age band");
  const colour = HEX.test(String(data.colour || "")) ? data.colour : "#0D3B32";
  const likes = Array.isArray(data.likes) ? data.likes.slice(0, 30).map((l) => text(l, 40)).filter(Boolean) : [];
  return { name, age: intOrNull(data.age, 0, 18, "age"), band, colour, likes };
};

const bookFields = (data) => {
  const title = text(data.title, 300);
  if (!title) throw new OpError("A book needs a title");
  const status = ["toread", "reading", "read"].includes(data.status) ? data.status : "toread";
  const who = Array.isArray(data.who) ? data.who.filter(isClientId).slice(0, 30) : [];
  return {
    title,
    author: text(data.author, 300),
    category: text(data.category, 40),
    ages: text(data.ages, 20),
    status,
    who,
    spine: text(data.spine, 20),
    cover: text(data.cover, 2000),
    pages: intOrNull(data.pages, 0, 100000, "pages"),
    page: intOrNull(data.page, 0, 100000, "page"),
    rating: intOrNull(data.rating, 0, 5, "rating"),
    started: dateOrNull(data.started, "started"),
    finished: dateOrNull(data.finished, "finished"),
    added: dateOrNull(data.added, "added"),
    notes: text(data.notes, 5000),
    extra: extraFrom(data, BOOK_FIELDS),
  };
};

const sessionFields = (data) => {
  const date = dateOrNull(data.date, "date");
  if (!date) throw new OpError("A reading-log entry needs a date");
  return {
    bookId: isClientId(data.bookId) ? data.bookId : "",
    childId: isClientId(data.childId) ? data.childId : null,
    date,
    minutes: intOrNull(data.minutes, 0, 1440, "minutes") || 0,
    page: intOrNull(data.page, 0, 100000, "page"),
    extra: extraFrom(data, SESSION_FIELDS),
  };
};

/* ------------------------------------------------------------- writing */

const findChild = (user, id) =>
  Child.findOne({
    parent: user._id,
    $or: isObjectId(id) ? [{ clientId: id }, { _id: id }] : [{ clientId: id }],
  });

const putChild = async (user, id, data) => {
  const fields = childFields(data);
  const existing = await findChild(user, id);
  if (existing) {
    Object.assign(existing, fields);
    await existing.save();
    return existing;
  }
  if ((await Child.countDocuments({ parent: user._id })) >= LIMITS.children) {
    throw new OpError(`A shelf can have at most ${LIMITS.children} children`);
  }
  return Child.create({ ...fields, parent: user._id, clientId: id });
};

const deleteChild = async (user, id) => {
  const child = await findChild(user, id);
  if (!child) return;
  await Child.deleteOne({ _id: child._id });
  if (child.student) {
    // Same as DELETE /api/children/:id: the student login is unlinked, not deleted.
    await User.updateOne({ _id: child.student, parentId: user._id }, { $set: { parentId: null } });
  }
};

const putBook = async (user, list, id, data) => {
  const fields = bookFields(data);
  const existing = await ShelfBook.findOne({ owner: user._id, list, clientId: id });
  if (existing) {
    Object.assign(existing, fields);
    existing.markModified("extra");
    await existing.save();
    return existing;
  }
  if ((await ShelfBook.countDocuments({ owner: user._id })) >= LIMITS.books) {
    throw new OpError(`A shelf can hold at most ${LIMITS.books} books`);
  }
  return ShelfBook.create({ ...fields, owner: user._id, list, clientId: id });
};

const putSession = async (user, id, data) => {
  const fields = sessionFields(data);
  const existing = await ReadingLog.findOne({ owner: user._id, clientId: id });
  if (existing) {
    Object.assign(existing, fields);
    existing.markModified("extra");
    await existing.save();
    return existing;
  }
  if ((await ReadingLog.countDocuments({ owner: user._id })) >= LIMITS.sessions) {
    throw new OpError(`The reading log can hold at most ${LIMITS.sessions} entries`);
  }
  return ReadingLog.create({ ...fields, owner: user._id, clientId: id });
};

const applyOp = async (user, op) => {
  if (!op || typeof op !== "object") throw new OpError("Each change must be an object");
  const { type, id } = op;
  if (!isClientId(id)) throw new OpError("Invalid id");
  if (!["put", "delete"].includes(op.op)) throw new OpError('op must be "put" or "delete"');
  const data = op.data && typeof op.data === "object" ? op.data : {};
  const del = op.op === "delete";

  switch (type) {
    case "child":
      return del ? deleteChild(user, id) : putChild(user, id, data);
    case "book":
      return del ? ShelfBook.deleteOne({ owner: user._id, list: "library", clientId: id }) : putBook(user, "library", id, data);
    case "wish":
      return del ? ShelfBook.deleteOne({ owner: user._id, list: "wishlist", clientId: id }) : putBook(user, "wishlist", id, data);
    case "session":
      return del ? ReadingLog.deleteOne({ owner: user._id, clientId: id }) : putSession(user, id, data);
    default:
      throw new OpError("type must be child, book, wish or session");
  }
};

const applyOrder = async (user, order) => {
  if (!order || typeof order !== "object") return;
  const plans = [
    [order.children, Child, (id) => ({ parent: user._id, $or: isObjectId(id) ? [{ clientId: id }, { _id: id }] : [{ clientId: id }] })],
    [order.books, ShelfBook, (id) => ({ owner: user._id, list: "library", clientId: id })],
    [order.wishlist, ShelfBook, (id) => ({ owner: user._id, list: "wishlist", clientId: id })],
    [order.sessions, ReadingLog, (id) => ({ owner: user._id, clientId: id })],
  ];
  for (const [ids, Model, filterFor] of plans) {
    if (!Array.isArray(ids)) continue;
    const writes = ids
      .filter(isClientId)
      .slice(0, LIMITS.sessions)
      .map((id, position) => ({ updateOne: { filter: filterFor(id), update: { $set: { position } } } }));
    if (writes.length) await Model.bulkWrite(writes, { ordered: false });
  }
};

const applyMeta = async (user, meta) => {
  if (!meta || typeof meta !== "object") return;
  const profile = await getProfile(user);

  if (meta.colour !== undefined && HEX.test(String(meta.colour))) profile.colour = meta.colour;

  if (Array.isArray(meta.activity)) {
    profile.activity = meta.activity
      .slice(0, LIMITS.activity)
      .filter((a) => a && typeof a === "object")
      .map((a) => ({ text: text(a.text, 300), at: Number(a.at) || Date.now() }));
  }

  if (meta.bedtime && typeof meta.bedtime === "object") {
    const b = meta.bedtime;
    profile.bedtime = {
      start: TIME.test(String(b.start || "")) ? b.start : (profile.bedtime && profile.bedtime.start) || "19:30",
      winddown: Math.max(0, Math.min(180, Math.floor(Number(b.winddown) || 0))),
      autoSwitch: b.autoSwitch !== false,
    };
  }

  await profile.save();
};

/* ------------------------------------------------------------ handlers */

const parentOnly = (req, res) => {
  if (req.user.role !== "parent") {
    res.status(403).json({ success: false, message: "The family shelf is for parent accounts" });
    return false;
  }
  return true;
};

// GET /api/shelf
const getShelf = async (req, res) => {
  try {
    if (!parentOnly(req, res)) return;
    return res.json({ success: true, shelf: await buildShelf(req.user) });
  } catch (error) {
    console.error("Get shelf error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// PATCH /api/shelf  { ops: [{ op, type, id, data }], order?, meta? }
const patchShelf = async (req, res) => {
  try {
    if (!parentOnly(req, res)) return;
    const body = req.body || {};
    const ops = Array.isArray(body.ops) ? body.ops : [];
    if (ops.length > 2000) {
      return res.status(400).json({ success: false, message: "Send at most 2000 changes at a time" });
    }

    const rejected = [];
    for (let i = 0; i < ops.length; i++) {
      try {
        await applyOp(req.user, ops[i]);
      } catch (error) {
        if (!(error instanceof OpError) && error.name !== "ValidationError" && error.code !== 11000) throw error;
        rejected.push({ index: i, id: ops[i] && ops[i].id, type: ops[i] && ops[i].type, message: error.message });
      }
    }

    await applyOrder(req.user, body.order);
    await applyMeta(req.user, body.meta);

    return res.json({ success: true, rejected, shelf: await buildShelf(req.user) });
  } catch (error) {
    console.error("Patch shelf error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ------------------------------------- REST: books and reading-log items */

const listFromQuery = (req) => (req.query.list === "wishlist" || req.params.list === "wishlist" ? "wishlist" : "library");

// GET /api/shelf/books?list=library|wishlist
const listBooks = async (req, res) => {
  try {
    if (!parentOnly(req, res)) return;
    const books = await ShelfBook.find({ owner: req.user._id, list: listFromQuery(req) }).sort({ position: 1, createdAt: -1 });
    return res.json({ success: true, books: books.map(bookOut) });
  } catch (error) {
    console.error("List shelf books error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /api/shelf/books?list=…  (body: a book; id optional)
// PUT  /api/shelf/books/:id?list=…
const saveBook = async (req, res) => {
  try {
    if (!parentOnly(req, res)) return;
    const data = req.body || {};
    const id = req.params.id || data.id || `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (!isClientId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const list = listFromQuery(req);
    if (req.method === "PUT" && !(await ShelfBook.exists({ owner: req.user._id, list, clientId: id }))) {
      return res.status(404).json({ success: false, message: "Book not found" });
    }
    const book = await putBook(req.user, list, id, data);
    return res.status(req.method === "POST" ? 201 : 200).json({ success: true, book: bookOut(book) });
  } catch (error) {
    if (error instanceof OpError) return res.status(400).json({ success: false, message: error.message });
    console.error("Save shelf book error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// DELETE /api/shelf/books/:id?list=…
const removeBook = async (req, res) => {
  try {
    if (!parentOnly(req, res)) return;
    const result = await ShelfBook.deleteOne({ owner: req.user._id, list: listFromQuery(req), clientId: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ success: false, message: "Book not found" });
    return res.json({ success: true, message: "Book removed" });
  } catch (error) {
    console.error("Remove shelf book error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /api/shelf/sessions?childId=&from=&to=
const listSessions = async (req, res) => {
  try {
    if (!parentOnly(req, res)) return;
    const query = { owner: req.user._id };
    if (req.query.childId) query.childId = String(req.query.childId);
    if (DATE.test(String(req.query.from || "")) || DATE.test(String(req.query.to || ""))) {
      query.date = {};
      if (DATE.test(String(req.query.from || ""))) query.date.$gte = req.query.from;
      if (DATE.test(String(req.query.to || ""))) query.date.$lte = req.query.to;
    }
    const sessions = await ReadingLog.find(query).sort({ date: -1, createdAt: -1 });
    return res.json({ success: true, sessions: sessions.map(sessionOut) });
  } catch (error) {
    console.error("List reading log error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /api/shelf/sessions
const addSession = async (req, res) => {
  try {
    if (!parentOnly(req, res)) return;
    const data = req.body || {};
    const id = data.id || `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (!isClientId(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const session = await putSession(req.user, id, data);
    return res.status(201).json({ success: true, session: sessionOut(session) });
  } catch (error) {
    if (error instanceof OpError) return res.status(400).json({ success: false, message: error.message });
    console.error("Add reading log error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// DELETE /api/shelf/sessions/:id
const removeSession = async (req, res) => {
  try {
    if (!parentOnly(req, res)) return;
    const result = await ReadingLog.deleteOne({ owner: req.user._id, clientId: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ success: false, message: "Reading-log entry not found" });
    return res.json({ success: true, message: "Entry removed" });
  } catch (error) {
    console.error("Remove reading log error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  getShelf,
  patchShelf,
  listBooks,
  saveBook,
  removeBook,
  listSessions,
  addSession,
  removeSession,
  buildShelf,
};
