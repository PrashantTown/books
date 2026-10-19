const mongoose = require("mongoose");

/**
 * An in-app notification (the bell).
 *
 * `to` uses the frontend's address format:
 *   "parent::someone@example.com"  one parent
 *   "admin::someone@example.com"   one administrator
 *   "parent::*" / "admin::*"       every parent / every administrator
 *
 * Read and dismissed state is kept per user, so marking a broadcast as read
 * only affects the person who read it.
 */
const notificationSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, trim: true },

    to: { type: String, required: true, lowercase: true, trim: true, index: true },

    kind: { type: String, default: "system", maxlength: 40 },
    tone: { type: String, default: "info", maxlength: 20 },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    body: { type: String, default: "", trim: true, maxlength: 1000 },
    go: { type: String, default: "", maxlength: 200 },
    tag: { type: String, default: "system", maxlength: 200 },

    // How many identical unread notifications were merged into this one.
    count: { type: Number, default: 1 },

    at: { type: Date, default: Date.now, index: true },

    readBy: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: [] },
    dismissedBy: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
