const express = require("express");
const protect = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const { listInvites, invite, accept, withdraw } = require("../controllers/familyController");

const router = express.Router();
router.use(protect, authorize("parent"));

router.get("/", listInvites);
router.post("/", invite);
router.post("/:id/accept", accept);
router.post("/:id/withdraw", withdraw);

module.exports = router;
