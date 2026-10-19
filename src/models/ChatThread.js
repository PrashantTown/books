const mongoose = require("mongoose");

/**
 * A chat conversation.
 *
 * kind "family": a parent and their own children's profiles
 *                (members look like "mail:parent@x.com", "kid:parent@x.com:c1").
 * kind "shelf":  a parent and a carer who accepted a shelf invitation.
 *
 * Member ids are the frontend's strings. `memberUsers` holds the adult
 * accounts involved and is what the server checks for access.
 */
const chatThreadSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, trim: true },
    key: { type: String, default: "", index: true },

    kind: { type: String, enum: ["family", "shelf"], required: true },
    title: { type: String, default: "", maxlength: 120 },

    // Email of the account a family thread belongs to.
    account: { type: String, default: "", lowercase: true, trim: true },

    members: { type: [String], default: [] },

    // Display names per member. The frontend uses { memberId: name }; it is
    // stored as a list because member ids contain dots (email addresses).
    names: {
      type: [
        {
          _id: false,
          member: { type: String, required: true },
          name: { type: String, default: "", maxlength: 120 },
        },
      ],
      default: [],
    },

    memberUsers: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: [], index: true },
    createdByUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    state: { type: String, enum: ["open", "closed"], default: "open" },

    // Time of the latest message (or creation).
    at: { type: Date, default: Date.now },
    startedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.model("ChatThread", chatThreadSchema);
