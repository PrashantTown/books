const mongoose = require("mongoose");

/**
 * Shelf-level settings for a parent account: the colour on their avatar, the
 * recent-activity feed on the dashboard and the bedtime routine.
 * The display name lives on User.name.
 */
const familyProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    colour: { type: String, default: "#0D3B32", maxlength: 20 },

    activity: {
      type: [
        {
          _id: false,
          text: { type: String, maxlength: 300 },
          at: { type: Number },
        },
      ],
      default: [],
    },

    bedtime: {
      start: { type: String, default: "19:30" },
      winddown: { type: Number, default: 15 },
      autoSwitch: { type: Boolean, default: true },
    },

    extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.model("FamilyProfile", familyProfileSchema);
