const mongoose = require("mongoose");

/**
 * Small per-user documents the frontend keeps as JSON: settings and
 * preferences, the reading interests picked at sign-up, the children's
 * avatar choices and which welcome steps have been dismissed.
 *
 * Each (user, key) pair holds one JSON value. Allowed keys are listed in
 * controllers/userDataController.js.
 */
const userDataSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    key: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

userDataSchema.index({ user: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("UserData", userDataSchema);
