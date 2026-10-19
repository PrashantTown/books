const express = require("express");
const protect = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const {
  listResources,
  createResource,
  updateResource,
  deleteResource,
} = require("../controllers/resourceController");

const router = express.Router();
router.use(protect);

router.get("/", listResources);
router.post("/", authorize("admin"), createResource);
router.put("/:id", authorize("admin"), updateResource);
router.delete("/:id", authorize("admin"), deleteResource);

module.exports = router;
