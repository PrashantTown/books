const express = require("express");
const protect = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const {
  createReview,
  getBookReviews,
  getReview,
  updateReview,
  deleteReview,
  getReviewSummary,
} = require("../controllers/reviewController");

const router = express.Router();
router.use(protect);
router.post("/:bookId", authorize("student"), createReview);
router.get("/book/:bookId/summary", getReviewSummary);
router.get("/book/:bookId", getBookReviews);
router.get("/:id", getReview);
router.put("/:id", authorize("student"), updateReview);
router.delete("/:id", authorize("student"), deleteReview);

module.exports = router;