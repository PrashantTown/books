const express = require("express");

const protect = require("../middleware/auth");
const adminOnly = require("../middleware/admin");
const { getDashboardStats } = require("../controllers/adminController");

const router = express.Router();

router.get("/test", protect, adminOnly, (req, res) => {
  res.json({
    success: true,
    message: "Welcome Admin",
    admin: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    },
  });
});

router.get("/dashboard", protect, adminOnly, getDashboardStats);

module.exports = router;