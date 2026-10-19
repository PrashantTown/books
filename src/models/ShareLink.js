const mongoose = require("mongoose");

/**
 * A read-only link to a family's wishlist. Anyone with the token can open it
 * until it expires or the owner turns sharing off. `items` is the snapshot
 * the owner chose to share (names can be reduced to initials).
 */
const shareLinkSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true, trim: true },

    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    ownerName: { type: String, default: "", maxlength: 120 },

    scope: { type: String, enum: ["link", "invite"], default: "link" },
    initials: { type: Boolean, default: false },
    expiry: { type: String, default: "30", maxlength: 10 },

    created: { type: Date, default: Date.now },
    expires: { type: Date, default: null },
    updated: { type: Date, default: Date.now },

    items: {
      type: [
        {
          _id: false,
          title: { type: String, maxlength: 300 },
          author: { type: String, maxlength: 300 },
          catName: { type: String, maxlength: 80 },
          ages: { type: String, maxlength: 20 },
          spine: { type: String, maxlength: 20 },
          forNames: { type: [String], default: [] },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ShareLink", shareLinkSchema);
