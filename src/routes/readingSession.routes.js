const express = require("express");
const protect = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const {
  startSession,
  endSession,
  getTodayUsage,
  getHistory,
  getRemainingTime,
} = require("../controllers/readingSessionController");

const router = express.Router();
router.use(protect);
router.post("/start", authorize("student"), startSession);
router.post("/:id/end", authorize("student"), endSession);
router.get("/usage/today", authorize("student"), getTodayUsage);
router.get("/history", authorize("student", "parent", "admin"), getHistory);
router.get("/remaining-time", authorize("student"), getRemainingTime);
router.get("/remaining-time/:childId", authorize("student", "parent", "admin"), getRemainingTime);

module.exports = router;