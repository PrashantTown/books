const mongoose = require("mongoose");

const chatMessageSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, trim: true },

    // clientId of the ChatThread.
    thread: { type: String, required: true, index: true },

    // Frontend member id of the sender, e.g. "mail:x@y.com" or "kid:x@y.com:c1".
    from: { type: String, required: true },
    name: { type: String, default: "", maxlength: 120 },
    body: { type: String, required: true, maxlength: 2000 },

    // The adult account that sent it (the parent, when a child's profile writes).
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ChatMessage", chatMessageSchema);
