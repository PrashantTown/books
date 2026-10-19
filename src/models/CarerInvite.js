const mongoose = require("mongoose");

/**
 * A parent inviting another adult (a carer, grandparent, partner) to share
 * their family shelf. The invited person accepts by signing in with the
 * invited email address.
 */
const carerInviteSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, trim: true },
    ref: { type: String, default: "" },

    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    name: { type: String, default: "", trim: true, maxlength: 120 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254, index: true },
    role: { type: String, default: "carer" },

    state: {
      type: String,
      enum: ["invited", "accepted", "withdrawn"],
      default: "invited",
      index: true,
    },

    // Who sent it (email and display name at the time).
    by: { type: String, default: "" },
    byName: { type: String, default: "" },

    // Set when the invited person accepts.
    carer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    at: { type: Date, default: Date.now },
    acceptedAt: { type: Date, default: null },
    withdrawnAt: { type: Date, default: null },
    withdrawnBy: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CarerInvite", carerInviteSchema);
