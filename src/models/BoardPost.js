const mongoose = require("mongoose");

/**
 * A message on the parents' community board, or a reply to one.
 * New posts are held for review unless the moderation rules let them
 * through straight away (see utils/moderation.js).
 */
const boardPostSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, trim: true },

    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Display name shown on the post, captured when it was written.
    fromName: { type: String, default: "A parent", maxlength: 120 },

    body: { type: String, required: true, trim: true, maxlength: 2000 },
    ages: { type: String, default: "", maxlength: 20 },

    // clientId of the post this replies to; empty for a top-level post.
    parentClientId: { type: String, default: "", index: true },

    state: {
      type: String,
      enum: ["pending", "published", "removed"],
      default: "pending",
      index: true,
    },
    reason: { type: String, default: "", maxlength: 600 },
    decidedBy: { type: String, default: "" },
    decidedAt: { type: Date, default: null },

    at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BoardPost", boardPostSchema);
