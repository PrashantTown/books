const mongoose = require("mongoose");

const bookSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    author: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    category: {
      type: String,
      required: true,
      enum: [
        "Adventure",
        "Fantasy",
        "Educational",
        "Fiction",
        "Non-fiction",
        "Poetry",
        "Picture Books",
      ],
    },
    ageGroup: {
      type: String,
      required: true,
      trim: true,
    },
    coverImage: {
      type: String,
      default: "",
    },
    readingUrl: {
      type: String,
      default: "",
    },
    pdfUrl: {
      type: String,
      default: "",
    },
    publicationInfo: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "inactive", "archived"],
      default: "active",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Book", bookSchema);
