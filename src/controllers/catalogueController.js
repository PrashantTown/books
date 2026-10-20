const CatalogueBook = require("../models/CatalogueBook");
const { isAdmin } = require("../utils/access");
const { isClientId, text, ms } = require("../utils/validate");

/**
 * The book catalogue the team recommends ("Discover books").
 *   GET    /api/catalogue       published books (administrators see hidden ones too)
 *   PUT    /api/catalogue/:id   admin: add or edit (id is the frontend's id)
 *   DELETE /api/catalogue/:id   admin: delete
 */

const HTTPS = /^https:\/\/[^\s"'<>]+$/i;
const LINKS = { link: "link", cover: "cover picture", readLink: "read link", watchLink: "watch link" };
const MAX_BOOKS = 2000;

const bookOut = (b) => {
  const out = {
    id: b.clientId,
    title: b.title,
    author: b.author,
    year: b.year === undefined ? null : b.year,
    pages: b.pages === undefined ? null : b.pages,
    category: b.category,
    ages: b.ages,
    source: b.source,
    note: b.note,
    link: b.link,
    cover: b.cover,
    readLink: b.readLink,
    watchLink: b.watchLink,
    state: b.state,
    sort: b.sort,
    by: b.by,
    at: ms(b.updatedAt),
  };
  return out;
};

const whole = (value, min, max) => {
  const n = Number(value);
  return value !== null && value !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

const fields = (body) => {
  const title = text(body.title, 300);
  if (!title) return { error: "Give the book a title" };

  const values = {
    title,
    author: text(body.author, 300),
    year: whole(body.year, 1600, 2100),
    pages: whole(body.pages, 1, 5000),
    category: text(body.category, 40),
    ages: text(body.ages, 20),
    source: text(body.source, 40) || "other",
    note: text(body.note, 1000),
    state: body.state === "hidden" ? "hidden" : "published",
  };
  for (const [key, label] of Object.entries(LINKS)) {
    const link = text(body[key], 2000);
    if (link && !HTTPS.test(link)) return { error: `The ${label} must start with https://` };
    values[key] = link;
  }
  const sort = Number(body.sort);
  values.sort = Number.isFinite(sort) ? Math.max(-1e9, Math.min(1e9, Math.round(sort))) : 0;
  return { values };
};

// GET /api/catalogue
const listCatalogue = async (req, res) => {
  try {
    const query = req.user && isAdmin(req.user) ? {} : { state: "published" };
    const items = await CatalogueBook.find(query).sort({ sort: 1, createdAt: -1 }).limit(MAX_BOOKS);
    return res.json({ success: true, items: items.map(bookOut) });
  } catch (error) {
    console.error("List catalogue error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// PUT /api/catalogue/:id
const putCatalogueBook = async (req, res) => {
  try {
    const clientId = req.params.id;
    if (!isClientId(clientId)) return res.status(400).json({ success: false, message: "Invalid id" });

    const { values, error } = fields(req.body || {});
    if (error) return res.status(400).json({ success: false, message: error });

    let book = await CatalogueBook.findOne({ clientId });
    if (book) {
      Object.assign(book, values, { by: req.user.email });
      await book.save();
    } else {
      if ((await CatalogueBook.countDocuments()) >= MAX_BOOKS) {
        return res.status(400).json({ success: false, message: `The catalogue can hold at most ${MAX_BOOKS} books` });
      }
      book = await CatalogueBook.create({ ...values, clientId, by: req.user.email });
    }
    return res.json({ success: true, item: bookOut(book) });
  } catch (error) {
    console.error("Save catalogue book error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// DELETE /api/catalogue/:id
const deleteCatalogueBook = async (req, res) => {
  try {
    const result = await CatalogueBook.deleteOne({ clientId: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ success: false, message: "Book not found" });
    return res.json({ success: true, message: "Book removed from the catalogue" });
  } catch (error) {
    console.error("Delete catalogue book error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { listCatalogue, putCatalogueBook, deleteCatalogueBook };
