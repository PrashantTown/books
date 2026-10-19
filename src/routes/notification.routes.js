const express = require("express");
const protect = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const {
  listNotes,
  sendNote,
  markRead,
  markAllRead,
  dismiss,
  clearAll,
} = require("../controllers/notificationController");

const router = express.Router();
router.use(protect, authorize("parent", "admin"));

router.get("/", listNotes);
router.post("/", sendNote);
router.post("/read-all", markAllRead);
router.post("/:id/read", markRead);
router.delete("/", clearAll);
router.delete("/:id", dismiss);

module.exports = router;
