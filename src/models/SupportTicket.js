const mongoose = require("mongoose");

// Details of an attached screenshot. Declared as its own schema because one
// of the fields is literally called "type".
const shotSchema = new mongoose.Schema(
  {
    name: { type: String, maxlength: 200 },
    type: { type: String, maxlength: 60 },
    size: { type: Number },
  },
  { _id: false }
);

/**
 * A problem report or contact message. Parents and administrators send them
 * from Settings; visitors send them from the contact form (source "public").
 * Board posts reported by a parent also arrive here.
 */
const supportTicketSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, trim: true },

    // Human-friendly reference, e.g. "PTG-1004". Assigned by the server.
    ref: { type: String, required: true, unique: true },

    // Null when a visitor used the public contact form.
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    source: { type: String, enum: ["parent", "admin", "public"], required: true },

    fromEmail: { type: String, default: "", lowercase: true, trim: true, maxlength: 254 },
    replyTo: { type: String, default: "", trim: true, maxlength: 254 },
    name: { type: String, default: "", trim: true, maxlength: 120 },

    area: { type: String, default: "", maxlength: 200 },
    severity: { type: String, enum: ["low", "med", "high"], default: "med" },
    severityText: { type: String, default: "", maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    diag: { type: String, default: "", maxlength: 1000 },

    // Details of an attached screenshot; the image itself is in
    // SupportScreenshot.
    shot: { type: shotSchema, default: null },

    state: { type: String, enum: ["open", "progress", "closed"], default: "open", index: true },
    decidedAt: { type: Date, default: null },

    at: { type: Date, default: Date.now },

    // Anything else the frontend sends with a ticket.
    extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.model("SupportTicket", supportTicketSchema);
