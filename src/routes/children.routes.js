const express = require("express");

const {
  createChild,
  getChildren,
  getChild,
  updateChild,
  deleteChild,
} = require("../controllers/childController");

const protect = require("../middleware/auth");
const authorize = require("../middleware/authorize");

const router = express.Router();

router.post("/", protect, authorize("parent"), createChild);

router.get("/", protect, authorize("parent"), getChildren);

router.get("/:id", protect, authorize("parent"), getChild);

router.put("/:id", protect, authorize("parent"), updateChild);

router.delete("/:id", protect, authorize("parent"), deleteChild);

module.exports = router;