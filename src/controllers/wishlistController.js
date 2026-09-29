const Book = require("../models/Book");
const Wishlist = require("../models/Wishlist");

const validId = (value) => /^[0-9a-fA-F]{24}$/.test(value || "");

const addToWishlist = async (req, res) => {
  try {
    if (!validId(req.params.bookId)) {
      return res.status(400).json({ success: false, message: "Invalid book ID" });
    }

    const book = await Book.findById(req.params.bookId);
    if (!book) return res.status(404).json({ success: false, message: "Book not found" });
    if (book.status !== "active") return res.status(403).json({ success: false, message: "Book is not active" });

    const existing = await Wishlist.findOne({ studentId: req.user._id, bookId: book._id });
    if (existing) return res.status(409).json({ success: false, message: "Book already exists in wishlist" });

    const wishlist = await Wishlist.create({ studentId: req.user._id, bookId: book._id });
    res.status(201).json({ success: true, message: "Book added to wishlist", wishlist });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: "Book already exists in wishlist" });
    console.error("Add wishlist error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getWishlist = async (req, res) => {
  try {
    const wishlist = await Wishlist.find({ studentId: req.user._id })
      .sort({ createdAt: -1 })
      .populate("bookId", "title author category ageGroup coverImage");
    res.json({ success: true, wishlist });
  } catch (error) {
    console.error("Get wishlist error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const removeFromWishlist = async (req, res) => {
  try {
    if (!validId(req.params.bookId)) {
      return res.status(400).json({ success: false, message: "Invalid book ID" });
    }
    const wishlist = await Wishlist.findOneAndDelete({ studentId: req.user._id, bookId: req.params.bookId });
    if (!wishlist) return res.status(404).json({ success: false, message: "Wishlist item not found" });
    res.json({ success: true, message: "Book removed from wishlist" });
  } catch (error) {
    console.error("Remove wishlist error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getWishlistStatus = async (req, res) => {
  try {
    if (!validId(req.params.bookId)) {
      return res.status(400).json({ success: false, message: "Invalid book ID" });
    }
    const exists = await Wishlist.exists({ studentId: req.user._id, bookId: req.params.bookId });
    res.json({ success: true, inWishlist: Boolean(exists) });
  } catch (error) {
    console.error("Get wishlist status error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { addToWishlist, getWishlist, removeFromWishlist, getWishlistStatus };