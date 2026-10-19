const express = require("express");
const protect = require("../middleware/auth");
const authorize = require("../middleware/authorize");

const board = require("../controllers/boardController");
const reviews = require("../controllers/bookReviewController");
const suggestions = require("../controllers/suggestionController");

const router = express.Router();
router.use(protect, authorize("parent", "admin"));

// Message board
router.get("/board", board.listPosts);
router.post("/board", authorize("parent"), board.createPost);
router.patch("/board/:id/moderation", authorize("admin"), board.moderatePost);
router.delete("/board/:id", board.deletePost);

// Parents' book reviews
router.get("/reviews", reviews.listReviews);
router.post("/reviews", authorize("parent"), reviews.createReview);
router.patch("/reviews/:id", authorize("parent"), reviews.updateReview);
router.patch("/reviews/:id/moderation", authorize("admin"), reviews.moderateReview);
router.delete("/reviews/:id", reviews.deleteReview);

// Resource suggestions
router.get("/suggestions", suggestions.listSuggestions);
router.post("/suggestions", authorize("parent"), suggestions.createSuggestion);
router.patch("/suggestions/:id/moderation", authorize("admin"), suggestions.moderateSuggestion);
router.delete("/suggestions/:id", suggestions.deleteSuggestion);

module.exports = router;
