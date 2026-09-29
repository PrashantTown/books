const mongoose = require("mongoose");

const wishlistSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    bookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Book",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

wishlistSchema.index({ studentId: 1, bookId: 1 }, { unique: true });

module.exports = mongoose.model("Wishlist", wishlistSchema);