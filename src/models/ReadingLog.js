const mongoose = require("mongoose");

/**
 * One entry in a family's reading log: "Harry read The Gruffalo for
 * 15 minutes on 2026-10-18 and got to page 18".
 *
 * Parents record these by hand on the shelf. This is different from
 * ReadingSession, which times a student's reading against parental controls.
 */
const readingLogSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    clientId: { type: String, required: true, trim: true },

    // Frontend ids of the shelf book and child.
    bookId: { type: String, default: "" },
    childId: { type: String, default: null },

    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    minutes: { type: Number, default: 0, min: 0, max: 1440 },
    page: { type: Number, default: null, min: 0 },

    position: { type: Number, default: 0 },
    extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

readingLogSchema.index({ owner: 1, clientId: 1 }, { unique: true });
readingLogSchema.index({ owner: 1, date: -1 });

module.exports = mongoose.model("ReadingLog", readingLogSchema);
