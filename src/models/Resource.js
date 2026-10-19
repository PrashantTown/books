const mongoose = require("mongoose");

/**
 * A guide or link published by the team from the admin console
 * ("From the team" on the parents' Resources tab).
 */
const resourceSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, trim: true },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, default: "", trim: true, maxlength: 4000 },
    category: { type: String, default: "", maxlength: 40 },
    ages: { type: String, default: "", maxlength: 20 },
    link: { type: String, default: "", trim: true, maxlength: 2000 },

    state: { type: String, enum: ["draft", "published"], default: "draft", index: true },

    // Email of the administrator who last saved it.
    by: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Resource", resourceSchema);
