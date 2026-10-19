const BookReview = require("../models/BookReview");
const { verdict } = require("../utils/moderation");
const { isAdmin, sameUser, ownerEmail, applyDecision } = require("../utils/access");
const { isClientId, text, ms } = require("../utils/validate");

/**
 * Parents' book reviews (separate from the students' catalogue reviews at
 * /api/reviews).
 *   GET    /api/community/reviews?book=<key>          published + your own (admins: all)
 *   POST   /api/community/reviews                     review a book (one per book)
 *   PATCH  /api/community/reviews/:id                 edit your review (goes back to review)
 *   PATCH  /api/community/reviews/:id/moderation      admin decision
 *   DELETE /api/community/reviews/:id                 your own, or any as admin
 */

const BODY_MIN = 10;
const BODY_MAX = 500;

// Same normalisation as the frontend: lower case, punctuation to spaces.
const norm = (s) =>
  String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^ | $/g, "");
const bookKey = (title, author) => `${norm(title)}|${norm(author)}`;

const reviewOut = (r) => ({
  id: r.clientId,
  book: r.bookKey,
  bookTitle: r.bookTitle,
  bookAuthor: r.bookAuthor,
  from: r.fromName,
  owner: ownerEmail(r),
  rating: r.rating,
  body: r.body,
  at: ms(r.at),
  edited: ms(r.edited),
  state: r.state,
  reason: r.reason,
  decidedBy: r.decidedBy,
  decidedAt: ms(r.decidedAt),
});

const validRating = (value) => {
  const n = Math.round(Number(value));
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

const listReviews = async (req, res) => {
  try {
    const query = isAdmin(req.user) ? {} : { $or: [{ state: "published" }, { owner: req.user._id }] };
    if (req.query.book) query.bookKey = String(req.query.book);
    const reviews = await BookReview.find(query).sort({ at: -1 }).limit(1000).populate("owner", "email");
    return res.json({ success: true, items: reviews.map(reviewOut) });
  } catch (error) {
    console.error("List book reviews error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const createReview = async (req, res) => {
  try {
    const body = text(req.body && req.body.body, BODY_MAX);
    const title = text(req.body && req.body.bookTitle, 300);
    const author = text(req.body && req.body.bookAuthor, 300);
    const rating = validRating(req.body && req.body.rating);
    const clientId = (req.body && req.body.id) || `rv-${Date.now().toString(36)}`;

    if (!isClientId(clientId)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!title) return res.status(400).json({ success: false, message: "Which book is this review for?" });
    if (!rating) return res.status(400).json({ success: false, message: "Rating must be a whole number from 1 to 5" });
    if (body.length < BODY_MIN) {
      return res.status(400).json({ success: false, message: `Write at least ${BODY_MIN} characters` });
    }

    const existing = await BookReview.findOne({ clientId }).populate("owner", "email");
    if (existing) {
      if (sameUser(existing.owner, req.user)) return res.json({ success: true, item: reviewOut(existing) });
      return res.status(409).json({ success: false, message: "That id is already in use" });
    }

    const key = bookKey(title, author);
    if (await BookReview.exists({ owner: req.user._id, bookKey: key })) {
      return res.status(409).json({ success: false, message: "You have already reviewed this book" });
    }

    const decision = await verdict(body, "");
    const review = await BookReview.create({
      clientId,
      owner: req.user._id,
      fromName: text(req.user.name, 120) || "A parent",
      bookKey: key,
      bookTitle: title,
      bookAuthor: author,
      rating,
      body,
      at: new Date(),
      state: decision === "approved" ? "published" : "pending",
      decidedBy: decision === "approved" ? "Automatic" : "",
      decidedAt: decision === "approved" ? new Date() : null,
    });
    await review.populate("owner", "email");

    return res.status(201).json({ success: true, item: reviewOut(review) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: "You have already reviewed this book" });
    console.error("Create book review error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const updateReview = async (req, res) => {
  try {
    const review = await BookReview.findOne({ clientId: req.params.id }).populate("owner", "email");
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    if (!sameUser(review.owner, req.user)) {
      return res.status(403).json({ success: false, message: "You can only edit your own review" });
    }

    if (req.body.rating !== undefined) {
      const rating = validRating(req.body.rating);
      if (!rating) return res.status(400).json({ success: false, message: "Rating must be a whole number from 1 to 5" });
      review.rating = rating;
    }
    if (req.body.body !== undefined) {
      const body = text(req.body.body, BODY_MAX);
      if (body.length < BODY_MIN) {
        return res.status(400).json({ success: false, message: `Write at least ${BODY_MIN} characters` });
      }
      review.body = body;
    }

    // An edited review goes through the same checks as a new one.
    const decision = await verdict(review.body, "");
    review.edited = new Date();
    review.state = decision === "approved" ? "published" : "pending";
    review.reason = "";
    review.decidedBy = decision === "approved" ? "Automatic" : "";
    review.decidedAt = decision === "approved" ? new Date() : null;
    await review.save();

    return res.json({ success: true, item: reviewOut(review) });
  } catch (error) {
    console.error("Update book review error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const moderateReview = async (req, res) => {
  try {
    const { state, reason } = req.body || {};
    if (!["published", "removed", "pending"].includes(state)) {
      return res.status(400).json({ success: false, message: "State must be published, removed or pending" });
    }
    if (state === "removed" && !String(reason || "").trim()) {
      return res.status(400).json({ success: false, message: "Give a reason when removing a review" });
    }

    const review = await BookReview.findOne({ clientId: req.params.id }).populate("owner", "email");
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });

    applyDecision(review, state, reason, req.user, "removed");
    await review.save();
    return res.json({ success: true, item: reviewOut(review) });
  } catch (error) {
    console.error("Moderate book review error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const deleteReview = async (req, res) => {
  try {
    const review = await BookReview.findOne({ clientId: req.params.id });
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    if (!isAdmin(req.user) && !sameUser(review.owner, req.user)) {
      return res.status(403).json({ success: false, message: "You can only delete your own review" });
    }
    await review.deleteOne();
    return res.json({ success: true, message: "Review deleted" });
  } catch (error) {
    console.error("Delete book review error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { listReviews, createReview, updateReview, moderateReview, deleteReview, bookKey };
