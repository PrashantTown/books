const express = require("express");
const protect = require("../middleware/auth");
const { getPlatformSettings } = require("../utils/platformSettings");

const router = express.Router();

// GET /api/settings/platform
// The platform rules administrators set in the console (moderation, lockout,
// retention). Any signed-in person can read them; the frontend uses them to
// explain what will happen (for example, that posts are held for review).
router.get("/platform", protect, async (req, res) => {
  try {
    return res.json({ success: true, settings: await getPlatformSettings() });
  } catch (error) {
    console.error("Platform settings error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
