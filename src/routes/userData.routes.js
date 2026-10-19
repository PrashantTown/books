const express = require("express");
const protect = require("../middleware/auth");
const { getAll, getOne, putOne, deleteOne } = require("../controllers/userDataController");

const router = express.Router();
router.use(protect);

router.get("/", getAll);
router.get("/:key", getOne);
router.put("/:key", putOne);
router.delete("/:key", deleteOne);

module.exports = router;
