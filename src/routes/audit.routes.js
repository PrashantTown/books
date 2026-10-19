const express = require("express");
const protect = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const { addEntry, listEntries } = require("../controllers/auditController");

const router = express.Router();
router.use(protect);

router.post("/", authorize("parent", "admin"), addEntry);
router.get("/", authorize("admin"), listEntries);

module.exports = router;
