const mongoose = require("mongoose");

/**
 * A resource suggested by a parent (a guide, a link, a local event).
 * Once an administrator approves it, it appears on everyone's Resources tab.
 */
const suggestionSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, trim: true },

    // Null for suggestions loaded by the seed script.
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    fromName: { type: String, default: "A parent", maxlength: 120 },

    origin: { type: String, enum: ["parent", "seed"], default: "parent" },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, default: "", trim: true, maxlength: 2000 },
    link: { type: String, default: "", trim: true, maxlength: 2000 },
    category: { type: String, default: "", maxlength: 40 },
    ages: { type: String, default: "", maxlength: 20 },

    at: { type: Date, default: Date.now },

    state: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    reason: { type: String, default: "", maxlength: 600 },
    decidedBy: { type: String, default: "" },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Suggestion", suggestionSchema);
