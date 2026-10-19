const mongoose = require("mongoose");

/**
 * A book on a family's own shelf (the "library") or on their wishlist.
 *
 * This is different from Book, which is the administrator-managed catalogue.
 * Field names follow the frontend so records round-trip without renaming.
 */
const shelfBookSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // The id the frontend gave this book, e.g. "b1" or "w1".
    clientId: { type: String, required: true, trim: true },

    list: { type: String, enum: ["library", "wishlist"], required: true },

    title: { type: String, required: true, trim: true, maxlength: 300 },
    author: { type: String, default: "", trim: true, maxlength: 300 },
    category: { type: String, default: "", maxlength: 40 },
    ages: { type: String, default: "", maxlength: 20 },
    status: { type: String, enum: ["toread", "reading", "read"], default: "toread" },

    // Child ids (frontend ids) this book is for.
    who: { type: [String], default: [] },

    spine: { type: String, default: "", maxlength: 20 },
    cover: { type: String, default: "", maxlength: 2000 },
    pages: { type: Number, default: null, min: 0 },
    page: { type: Number, default: null, min: 0 },
    rating: { type: Number, default: null, min: 0, max: 5 },

    // Dates as the frontend stores them: "YYYY-MM-DD".
    started: { type: String, default: null },
    finished: { type: String, default: null },
    added: { type: String, default: null },

    notes: { type: String, default: "", maxlength: 5000 },

    // Order within the list on the shelf.
    position: { type: Number, default: 0 },

    // Any other fields the frontend keeps on a book (for example sourceId),
    // stored as-is so nothing is lost.
    extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

shelfBookSchema.index({ owner: 1, list: 1, clientId: 1 }, { unique: true });

module.exports = mongoose.model("ShelfBook", shelfBookSchema);
