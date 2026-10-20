const express = require("express");

const {
  register,
  login,
  verifyAdminCode,
  getMe,
  logout,
  updateMe,
  changePassword,
  deleteMe,
  forgotPassword,
  resetPassword,
  confirmEmail,
  resendConfirmation,
  verifyPassword,
  logoutOthers,
} = require("../controllers/authController");

const protect = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");

const router = express.Router();

// Per visitor (IP) limits on the public endpoints, to slow down password
// guessing and sign-up spam. Override in .env if a school or library network
// puts many families behind one address.
const { limitFromEnv } = rateLimit;
const signInLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: limitFromEnv("RATE_LIMIT_LOGIN", 50),
  keyFn: (req) => `login:${req.ip}`,
  message: "Too many sign-in attempts. Wait a few minutes and try again.",
});
const signUpLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: limitFromEnv("RATE_LIMIT_SIGNUP", 20),
  keyFn: (req) => `register:${req.ip}`,
});
const forgotLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: limitFromEnv("RATE_LIMIT_FORGOT", 10),
  keyFn: (req) => `forgot:${req.ip}`,
});

router.post("/register", signUpLimit, register);

router.post("/login", signInLimit, login);

router.post("/admin-code", signInLimit, verifyAdminCode);

router.post("/forgot-password", forgotLimit, forgotPassword);

router.post("/reset-password", signInLimit, resetPassword);

// New accounts confirm their email address (when email is set up).
router.post("/confirm-email", signInLimit, confirmEmail);

router.post("/resend-confirmation", forgotLimit, resendConfirmation);

router.get("/me", protect, getMe);

router.patch("/me", protect, updateMe);

router.delete("/me", protect, deleteMe);

router.put("/password", protect, changePassword);

router.post("/logout", protect, logout);

router.post("/logout-others", protect, logoutOthers);

// Settings checks the current password before sensitive changes.
router.post("/verify-password", protect, signInLimit, verifyPassword);

module.exports = router;
