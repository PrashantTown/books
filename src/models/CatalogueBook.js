const mongoose = require("mongoose");

/**
 * A book the team recommends. Families see published ones under "Discover
 * books" and can add them to their shelf or wishlist; administrators manage
 * the list from the console's Catalogue tab.
 */
const catalogueBookSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, trim: true },

    title: { type: String, required: true, trim: true, maxlength: 300 },
    author: { type: String, default: "", trim: true, maxlength: 300 },
    year: { type: Number, default: null, min: 1600, max: 2100 },
    pages: { type: Number, default: null, min: 1, max: 5000 },

    category: { type: String, default: "", trim: true, maxlength: 40 },
    ages: { type: String, default: "", trim: true, maxlength: 20 },

    // Where the recommendation comes from (for example a library list).
    source: { type: String, default: "other", trim: true, maxlength: 40 },
    note: { type: String, default: "", trim: true, maxlength: 1000 },

    // https:// links only: the source's page for the book, a cover image,
    // somewhere to read it, a read-along video.
    link: { type: String, default: "", trim: true, maxlength: 2000 },
    cover: { type: String, default: "", trim: true, maxlength: 2000 },
    readLink: { type: String, default: "", trim: true, maxlength: 2000 },
    watchLink: { type: String, default: "", trim: true, maxlength: 2000 },

    state: { type: String, enum: ["published", "hidden"], default: "published", index: true },
    sort: { type: Number, default: 0 },

    // Email of the administrator who last saved it.
    by: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CatalogueBook", catalogueBookSchema);
