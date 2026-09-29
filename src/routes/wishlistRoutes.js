const express = require("express");
const protect = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const {
  addToWishlist,
  getWishlist,
  removeFromWishlist,
  getWishlistStatus,
} = require("../controllers/wishlistController");

const router = express.Router();
router.use(protect, authorize("student"));
router.post("/:bookId", addToWishlist);
router.get("/", getWishlist);
router.delete("/:bookId", removeFromWishlist);
router.get("/:bookId/status", getWishlistStatus);

module.exports = router;