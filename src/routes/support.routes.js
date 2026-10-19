const express = require("express");
const protect = require("../middleware/auth");
const optionalAuth = require("../middleware/optionalAuth");
const authorize = require("../middleware/authorize");
const rateLimit = require("../middleware/rateLimit");
const {
  createTicket,
  listTickets,
  updateTicket,
  uploadScreenshot,
  getScreenshot,
  deleteScreenshot,
} = require("../controllers/supportController");

const router = express.Router();

// The contact form is open to visitors, so keep it from being flooded.
const contactLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: rateLimit.limitFromEnv("RATE_LIMIT_CONTACT", 15),
  keyFn: (req) => `support:${req.ip}`,
  message: "Too many messages from here. Please try again later.",
});

router.post("/", contactLimit, optionalAuth, createTicket);
router.get("/", protect, listTickets);
router.patch("/:id", protect, authorize("admin"), updateTicket);

router.post("/:id/screenshot", protect, uploadScreenshot);
router.get("/:id/screenshot", protect, getScreenshot);
router.delete("/:id/screenshot", protect, deleteScreenshot);

module.exports = router;
