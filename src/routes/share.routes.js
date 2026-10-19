const express = require("express");
const protect = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const rateLimit = require("../middleware/rateLimit");
const { getMine, putMine, deleteMine, openShared } = require("../controllers/shareController");

const router = express.Router();

const openLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, keyFn: (req) => `share:${req.ip}` });

router.get("/mine", protect, authorize("parent"), getMine);
router.put("/mine", protect, authorize("parent"), putMine);
router.delete("/mine", protect, authorize("parent"), deleteMine);

// Public: anyone with the link
router.get("/:token", openLimit, openShared);

module.exports = router;
