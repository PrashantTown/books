const mongoose = require("mongoose");

/**
 * A parent's review of any book, matched by title and author.
 *
 * This is separate from Review, which is a student's review of a book in
 * the catalogue. Parent reviews go through moderation before other parents
 * can see them.
 */
const bookReviewSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, trim: true },

    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    fromName: { type: String, default: "A parent", maxlength: 120 },

    // Normalised "title|author", the same key the frontend computes.
    bookKey: { type: String, required: true, index: true },
    bookTitle: { type: String, required: true, trim: true, maxlength: 300 },
    bookAuthor: { type: String, default: "", trim: true, maxlength: 300 },

    rating: { type: Number, required: true, min: 1, max: 5 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },

    at: { type: Date, default: Date.now },
    edited: { type: Date, default: null },

    state: {
      type: String,
      enum: ["pending", "published", "removed"],
      default: "pending",
      index: true,
    },
    reason: { type: String, default: "", maxlength: 600 },
    decidedBy: { type: String, default: "" },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One review per parent per book.
bookReviewSchema.index({ owner: 1, bookKey: 1 }, { unique: true });

module.exports = mongoose.model("BookReview", bookReviewSchema);
