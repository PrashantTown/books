const mongoose = require("mongoose");

/**
 * The activity log administrators see in the console ("who did what").
 * Entries come from the frontend and from the server itself (sign-ins,
 * lockouts, account changes).
 */
const auditLogSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, trim: true },

    kind: { type: String, default: "account", maxlength: 40, index: true },
    what: { type: String, required: true, maxlength: 500 },
    // Email of the person who did it, or "system".
    who: { type: String, default: "system", maxlength: 254 },
    detail: { type: String, default: "", maxlength: 1000 },

    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuditLog", auditLogSchema);
