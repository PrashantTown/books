const mongoose = require("mongoose");

/**
 * When a chat member last read a thread. Unread counts are messages from
 * someone else that arrived after this time.
 */
const chatReadSchema = new mongoose.Schema(
  {
    thread: { type: String, required: true },
    member: { type: String, required: true },
    at: { type: Number, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

chatReadSchema.index({ thread: 1, member: 1 }, { unique: true });

module.exports = mongoose.model("ChatRead", chatReadSchema);
