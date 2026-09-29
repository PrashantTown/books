const mongoose = require("mongoose");

const readingSessionSchema = new mongoose.Schema(
  {
    childId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Child",
      required: true,
      index: true,
    },
    bookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Book",
      required: true,
      index: true,
    },
    startTime: { type: Date, required: true },
    endTime: { type: Date, default: null },
    duration: { type: Number, default: 0, min: 0 },
    date: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["active", "completed", "blocked"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true }
);

readingSessionSchema.index({ childId: 1, date: 1, status: 1 });

module.exports = mongoose.model("ReadingSession", readingSessionSchema);