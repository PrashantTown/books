const mongoose = require("mongoose");

/**
 * A project tile on the home page (Reading for pleasure, Four Voices, and any
 * the team adds from the console). Each one can have its own page,
 * project.html?p=<slug>, listing the resources posted for it.
 */
const categorySchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 40 },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 40 },

    title: { type: String, required: true, trim: true, maxlength: 120 },
    blurb: { type: String, default: "", trim: true, maxlength: 400 },
    status: { type: String, enum: ["open", "soon", "hidden"], default: "soon" },

    // Resource categories families can filter by on the project page.
    categories: { type: [categorySchema], default: [] },

    sort: { type: Number, default: 0 },

    // Where the tile goes (a page on this site or an https:// address), and
    // its picture. Empty means project.html?p=<slug> and no picture.
    link: { type: String, default: "", trim: true, maxlength: 500 },
    image: { type: String, default: "", trim: true, maxlength: 500 },

    // The two projects the site was built with can be edited but not deleted.
    builtIn: { type: Boolean, default: false },

    // Email of the administrator who last saved it.
    by: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Project", projectSchema);
