const express = require("express");
const protect = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const {
  getChat,
  openThread,
  sendMessage,
  markRead,
  updateThread,
  deleteThread,
} = require("../controllers/chatController");

const router = express.Router();
router.use(protect, authorize("parent"));

router.get("/", getChat);
router.post("/threads", openThread);
router.post("/threads/:id/messages", sendMessage);
router.put("/threads/:id/read", markRead);
router.patch("/threads/:id", updateThread);
router.delete("/threads/:id", deleteThread);

module.exports = router;
