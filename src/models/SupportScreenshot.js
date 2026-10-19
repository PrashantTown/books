const mongoose = require("mongoose");

/**
 * The image attached to a support ticket, kept apart from the ticket so
 * listing tickets never loads the image bytes. Limited to 2 MB.
 */
const supportScreenshotSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportTicket",
      required: true,
      unique: true,
    },
    contentType: { type: String, required: true },
    data: { type: Buffer, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SupportScreenshot", supportScreenshotSchema);
