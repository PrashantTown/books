const express = require("express");
const { mailEnabled } = require("../utils/mailer");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "API is healthy",
    // Whether email is set up (reset links, confirmations, invitations).
    email: mailEnabled(),
  });
});

module.exports = router;