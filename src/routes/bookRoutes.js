const express = require("express");

const {
  createBook,
  getBooks,
  getBook,
  updateBook,
  archiveBook,
  activateBook,
  deactivateBook,
} = require("../controllers/bookController");

const protect = require("../middleware/auth");
const authorize = require("../middleware/authorize");

const router = express.Router();

router.post("/", protect, authorize("admin"), createBook);
router.get("/", protect, getBooks);
router.get("/:id", protect, getBook);
router.put("/:id", protect, authorize("admin"), updateBook);
router.delete("/:id", protect, authorize("admin"), archiveBook);
router.patch("/:id/activate", protect, authorize("admin"), activateBook);
router.patch("/:id/deactivate", protect, authorize("admin"), deactivateBook);

module.exports = router;
