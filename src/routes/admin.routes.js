const express = require("express");

const protect = require("../middleware/auth");
const adminOnly = require("../middleware/admin");
const { getDashboardStats } = require("../controllers/adminController");
const {
  listUsers,
  createUser,
  setStatus,
  setTempPassword,
  deleteUser,
} = require("../controllers/adminUserController");

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

// Account management for the admin console
router.get("/users", protect, adminOnly, listUsers);
router.post("/users", protect, adminOnly, createUser);
router.patch("/users/:id/status", protect, adminOnly, setStatus);
router.post("/users/:id/temp-password", protect, adminOnly, setTempPassword);
router.delete("/users/:id", protect, adminOnly, deleteUser);

module.exports = router;
