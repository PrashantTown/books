const express = require("express");
const protect = require("../middleware/auth");
const {
  getShelf,
  patchShelf,
  listBooks,
  saveBook,
  removeBook,
  listSessions,
  addSession,
  removeSession,
} = require("../controllers/shelfController");

const router = express.Router();
router.use(protect);

// Whole shelf (what the frontend loads and saves)
router.get("/", getShelf);
router.patch("/", patchShelf);

// Books on the shelf; ?list=wishlist for the wishlist
router.get("/books", listBooks);
router.post("/books", saveBook);
router.put("/books/:id", saveBook);
router.delete("/books/:id", removeBook);

// Reading log
router.get("/sessions", listSessions);
router.post("/sessions", addSession);
router.delete("/sessions/:id", removeSession);

module.exports = router;
