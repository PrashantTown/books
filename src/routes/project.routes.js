const express = require("express");
const protect = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const { listProjects, putProject, deleteProject } = require("../controllers/projectController");

const router = express.Router();

// The home page shows the project tiles to visitors, so reading is public.
router.get("/", listProjects);
router.put("/:id", protect, authorize("admin"), putProject);
router.delete("/:id", protect, authorize("admin"), deleteProject);

module.exports = router;
