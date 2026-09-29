const mongoose = require("mongoose");

const parentalControlSchema = new mongoose.Schema(
  {
    childId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Child",
      required: true,
      index: true,
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    dailyLimit: { type: Number, required: true, min: 1 },
    sessionLimit: { type: Number, required: true, min: 1 },
    allowedStartTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    allowedEndTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    externalLinksAllowed: { type: Boolean, default: false },
    isEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

parentalControlSchema.index({ childId: 1, parentId: 1 }, { unique: true });

module.exports = mongoose.model("ParentalControl", parentalControlSchema);