const express = require("express");
const protect = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const {
  createControls,
  getControls,
  updateControls,
  enableControls,
  disableControls,
  getExternalLinks,
} = require("../controllers/parentalControlController");

const router = express.Router();
router.use(protect, authorize("parent", "admin"));
router.get("/:childId", getControls);
router.post("/:childId", createControls);
router.put("/:childId", updateControls);
router.patch("/:childId/enable", enableControls);
router.patch("/:childId/disable", disableControls);
router.get("/:childId/external-links", getExternalLinks);

module.exports = router;