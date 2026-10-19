const Book = require("../models/Book");
const Review = require("../models/Review");

const validId = (value) => /^[0-9a-fA-F]{24}$/.test(value || "");

const validateReview = (body, requireRating = true) => {
  if (requireRating && body.rating === undefined) return "Rating is required";
  if (body.rating !== undefined) {
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return "Rating must be an integer from 1 to 5";
  }
  if (body.comment !== undefined && typeof body.comment !== "string") return "Comment must be a string";
  return null;
};

const createReview = async (req, res) => {
  try {
    if (!validId(req.params.bookId)) return res.status(400).json({ success: false, message: "Invalid book ID" });
    // Check the request itself before the book, so a bad rating is always a 400.
    const validationError = validateReview(req.body || {}, true);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const book = await Book.findById(req.params.bookId);
    if (!book) return res.status(404).json({ success: false, message: "Book not found" });
    if (book.status !== "active") return res.status(403).json({ success: false, message: "Book is not active" });
    const existing = await Review.findOne({ studentId: req.user._id, bookId: book._id });
    if (existing) return res.status(409).json({ success: false, message: "You have already reviewed this book" });
    const review = await Review.create({ studentId: req.user._id, bookId: book._id, rating: Number(req.body.rating), comment: req.body.comment || "" });
    res.status(201).json({ success: true, message: "Review created", review });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: "You have already reviewed this book" });
    console.error("Create review error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getBookReviews = async (req, res) => {
  try {
    if (!validId(req.params.bookId)) return res.status(400).json({ success: false, message: "Invalid book ID" });
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const limit = Number(req.query.limit) > 0 ? Math.min(Number(req.query.limit), 100) : 10;
    const query = { bookId: req.params.bookId };
    const [total, reviews] = await Promise.all([
      Review.countDocuments(query),
      Review.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("studentId", "name"),
    ]);
    res.json({ success: true, reviews, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("Get book reviews error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getReview = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid review ID" });
    const review = await Review.findById(req.params.id).populate("studentId", "name").populate("bookId", "title author");
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    res.json({ success: true, review });
  } catch (error) {
    console.error("Get review error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const updateReview = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid review ID" });
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    if (review.studentId.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, message: "You can only update your own review" });
    const validationError = validateReview(req.body || {}, false);
    if (req.body.rating === undefined && req.body.comment === undefined) {
      return res.status(400).json({ success: false, message: "Rating or comment is required" });
    }
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    if (req.body.rating !== undefined) review.rating = Number(req.body.rating);
    if (req.body.comment !== undefined) review.comment = req.body.comment;
    await review.save();
    res.json({ success: true, message: "Review updated", review });
  } catch (error) {
    console.error("Update review error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const deleteReview = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid review ID" });
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    if (review.studentId.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, message: "You can only delete your own review" });
    await review.deleteOne();
    res.json({ success: true, message: "Review deleted" });
  } catch (error) {
    console.error("Delete review error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getReviewSummary = async (req, res) => {
  try {
    if (!validId(req.params.bookId)) return res.status(400).json({ success: false, message: "Invalid book ID" });
    const summary = await Review.aggregate([
      { $match: { bookId: require("mongoose").Types.ObjectId.createFromHexString(req.params.bookId) } },
      { $group: { _id: "$bookId", averageRating: { $avg: "$rating" }, totalReviews: { $sum: 1 }, ratings: { $push: "$rating" } } },
    ]);
    const data = { averageRating: 0, totalReviews: 0, ratingBreakdown: { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0 } };
    if (summary[0]) {
      data.averageRating = Math.round(summary[0].averageRating * 10) / 10;
      data.totalReviews = summary[0].totalReviews;
      summary[0].ratings.forEach((rating) => { data.ratingBreakdown[String(rating)] += 1; });
    }
    res.json({ success: true, data });
  } catch (error) {
    console.error("Review summary error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { createReview, getBookReviews, getReview, updateReview, deleteReview, getReviewSummary };