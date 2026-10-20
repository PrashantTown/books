const express = require("express");
const protect = require("../middleware/auth");
const optionalAuth = require("../middleware/optionalAuth");
const authorize = require("../middleware/authorize");
const { listCatalogue, putCatalogueBook, deleteCatalogueBook } = require("../controllers/catalogueController");

const router = express.Router();

// Anyone can read the published catalogue; administrators also see hidden books.
router.get("/", optionalAuth, listCatalogue);
router.put("/:id", protect, authorize("admin"), putCatalogueBook);
router.delete("/:id", protect, authorize("admin"), deleteCatalogueBook);

module.exports = router;
