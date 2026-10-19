const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const generateToken = require("../utils/generateToken");
const { getPlatformSettings } = require("../utils/platformSettings");
const { writeAudit } = require("../utils/audit");
const { notifyAdmins } = require("../utils/notify");
const { deleteAccountAndData } = require("../utils/accountCleanup");
const { renameAccountEmail } = require("../utils/emailRename");
const { isEmail, text, lower } = require("../utils/validate");

const MIN_PASSWORD = { parent: 8, student: 8, admin: 12 };

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
});

// REGISTER
// Anyone can create a parent account. Administrator accounts are created by
// an existing administrator (POST /api/admin/users) or the seed script, and
// student logins are created when a parent adds a child.
const register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};

    // Check required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required",
      });
    }

    const requestedRole = String(role || "parent").toLowerCase();
    if (requestedRole !== "parent") {
      return res.status(403).json({
        success: false,
        message: "Only parent accounts can be created here",
      });
    }

    if (String(name).trim().length < 2) {
      return res.status(400).json({ success: false, message: "Name must be at least 2 characters" });
    }

    if (!isEmail(email)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address" });
    }

    if (String(password).length < MIN_PASSWORD.parent) {
      return res.status(400).json({
        success: false,
        message: `Password must be at least ${MIN_PASSWORD.parent} characters`,
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      email: email.toLowerCase(),
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User already exists",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await User.create({
      name: text(name, 120),
      email: lower(email),
      password: hashedPassword,
      role: "parent",
      lastSeen: new Date(),
      passwordChangedAt: new Date(),
    });

    await writeAudit({ kind: "auth", what: "Parent account created", who: user.email, user: user._id });

    // Generate JWT
    const token = generateToken(user);
    res.status(201).json({
      success: true,
      message: "Registration successful",
      token,
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Register error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/* ---------------------------------------------------------- admin code */

// A second step for administrator sign-in. When ADMIN_LOGIN_CODE is set,
// signing in as an administrator returns a short-lived challenge instead of a
// token, and POST /api/auth/admin-code exchanges challenge + code for a token.
const ADMIN_CODE_TRIES = 3;
const usedChallenges = new Map(); // challenge id -> { fails, done, exp }

const sweepChallenges = () => {
  const now = Date.now();
  for (const [id, entry] of usedChallenges) {
    if (entry.exp <= now) usedChallenges.delete(id);
  }
};

const adminCodeRequired = () => Boolean(String(process.env.ADMIN_LOGIN_CODE || "").trim());

const sameCode = (given, expected) => {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(expected || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const issueChallenge = (user) => {
  const jti = crypto.randomBytes(12).toString("hex");
  return jwt.sign(
    { userId: user._id, tokenVersion: user.tokenVersion, purpose: "admin-code", jti },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );
};

// LOGIN
const login = async (req, res) => {
  try {
    const { email, password, role } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Find user
    const user = await User.findOne({
      email: String(email).toLowerCase(),
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Check account status
    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        code: user.lockedOut ? "ACCOUNT_LOCKED" : "ACCOUNT_SUSPENDED",
        message: user.lockedOut
          ? "This account is locked after too many wrong passwords"
          : "Your account has been suspended",
      });
    }

    // Check password
    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      const { lockAttempts } = await getPlatformSettings();
      const limit = Math.max(1, Number(lockAttempts) || 5);
      user.failedLogins = (user.failedLogins || 0) + 1;

      if (user.failedLogins >= limit && user.role !== "admin") {
        user.status = "suspended";
        user.lockedOut = true;
        user.failedLogins = 0;
        user.tokenVersion += 1;
        await user.save();

        await writeAudit({ kind: "auth", what: `Account locked after ${limit} wrong passwords`, who: user.email, user: user._id });
        await notifyAdmins({
          kind: "account",
          tone: "alert",
          title: `Account locked — ${user.email}`,
          body: `${limit} wrong passwords in a row. Restore access from Accounts once you have checked with them.`,
          go: "accounts",
          tag: `locked-${user.email}`,
        });

        return res.status(403).json({
          success: false,
          code: "ACCOUNT_LOCKED",
          message: "Too many wrong passwords, so this account is now locked",
        });
      }

      await user.save();
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        attemptsLeft: user.role === "admin" ? undefined : Math.max(0, limit - user.failedLogins),
      });
    }

    // The frontend says which side it is signing in to. Only checked after the
    // password, so it can't be used to find out which emails are admins.
    if (role) {
      const wanted = String(role).toLowerCase();
      if (wanted === "admin" && user.role !== "admin") {
        return res.status(403).json({
          success: false,
          code: "NOT_ADMIN",
          message: "This account is not an administrator account",
        });
      }
      if (wanted === "parent" && user.role !== "parent") {
        return res.status(403).json({
          success: false,
          code: user.role === "admin" ? "USE_ADMIN" : "NOT_PARENT",
          message: user.role === "admin"
            ? "This is an administrator account. Choose Administrator to sign in."
            : "This account can't sign in here",
        });
      }
    }

    user.failedLogins = 0;

    if (user.role === "admin" && adminCodeRequired()) {
      await user.save();
      return res.json({
        success: true,
        codeRequired: true,
        challenge: issueChallenge(user),
        message: "Enter the administrator code to finish signing in",
      });
    }

    // Update last seen
    user.lastSeen = new Date();
    await user.save();

    await writeAudit({
      kind: "auth",
      what: user.role === "admin" ? "Administrator signed in" : user.role === "parent" ? "Parent signed in" : "Student signed in",
      who: user.email,
      user: user._id,
    });

    // Generate token
    const token = generateToken(user);

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        ...publicUser(user),
        tempPassword: user.tempPassword,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// VERIFY ADMIN CODE (second sign-in step for administrators)
const verifyAdminCode = async (req, res) => {
  try {
    const { challenge, code } = req.body || {};
    if (!challenge || !code) {
      return res.status(400).json({ success: false, message: "Challenge and code are required" });
    }

    let decoded;
    try {
      decoded = jwt.verify(challenge, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({ success: false, code: "CHALLENGE_EXPIRED", message: "That sign-in has expired. Start again." });
    }
    if (decoded.purpose !== "admin-code" || !decoded.jti) {
      return res.status(401).json({ success: false, code: "CHALLENGE_EXPIRED", message: "That sign-in has expired. Start again." });
    }

    sweepChallenges();
    const entry = usedChallenges.get(decoded.jti) || { fails: 0, done: false, exp: decoded.exp * 1000 };
    if (entry.done) {
      return res.status(401).json({ success: false, code: "CHALLENGE_EXPIRED", message: "That sign-in has expired. Start again." });
    }

    const user = await User.findById(decoded.userId);
    if (!user || user.role !== "admin" || user.status === "suspended" || user.tokenVersion !== decoded.tokenVersion) {
      return res.status(401).json({ success: false, code: "CHALLENGE_EXPIRED", message: "That sign-in has expired. Start again." });
    }

    if (!sameCode(String(code).trim(), String(process.env.ADMIN_LOGIN_CODE || "").trim())) {
      entry.fails += 1;
      if (entry.fails >= ADMIN_CODE_TRIES) {
        entry.done = true;
        usedChallenges.set(decoded.jti, entry);
        await writeAudit({ kind: "auth", what: "Administrator sign-in abandoned after three wrong codes", who: user.email, user: user._id });
        return res.status(401).json({
          success: false,
          code: "CODE_ABANDONED",
          message: "Three wrong codes — that sign-in was abandoned and logged",
        });
      }
      usedChallenges.set(decoded.jti, entry);
      await writeAudit({
        kind: "auth",
        what: `Failed administrator one-time code (attempt ${entry.fails} of ${ADMIN_CODE_TRIES})`,
        who: user.email,
        user: user._id,
      });
      return res.status(401).json({
        success: false,
        code: "WRONG_CODE",
        message: "That code is not right",
        attemptsLeft: ADMIN_CODE_TRIES - entry.fails,
      });
    }

    entry.done = true;
    usedChallenges.set(decoded.jti, entry);

    user.lastSeen = new Date();
    await user.save();
    await writeAudit({ kind: "auth", what: "Administrator signed in", who: user.email, user: user._id });

    return res.json({
      success: true,
      message: "Login successful",
      token: generateToken(user),
      user: { ...publicUser(user), tempPassword: user.tempPassword },
    });
  } catch (error) {
    console.error("Admin code error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getMe = async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        status: req.user.status,
        lastSeen: req.user.lastSeen,
        createdAt: req.user.createdAt,
        tempPassword: req.user.tempPassword,
        passwordChangedAt: req.user.passwordChangedAt,
      },
    });
  } catch (error) {
    console.error("Get me error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const logout = async (req, res) => {
  try {
    req.user.tokenVersion += 1;

    await req.user.save();

    await writeAudit({
      kind: "auth",
      what: req.user.role === "admin" ? "Administrator signed out" : "Parent signed out",
      who: req.user.email,
      user: req.user._id,
    });

    res.json({
      success: true,
      message: "Logout successful. Token has been invalidated.",
    });
  } catch (error) {
    console.error("Logout error:", error);

    res.status(500).json({
      success: false,
      message: "Logout failed",
    });
  }
};

// UPDATE MY DETAILS (name and/or sign-in email)
const updateMe = async (req, res) => {
  try {
    const { name, email } = req.body || {};
    const user = req.user;
    const oldEmail = user.email;

    if (name !== undefined) {
      if (String(name).trim().length < 1) {
        return res.status(400).json({ success: false, message: "Name can't be empty" });
      }
      user.name = text(name, 120);
    }

    if (email !== undefined && lower(email) !== user.email) {
      if (!isEmail(email)) {
        return res.status(400).json({ success: false, message: "Enter a valid email address" });
      }
      const taken = await User.exists({ email: lower(email), _id: { $ne: user._id } });
      if (taken) {
        return res.status(409).json({ success: false, message: "That email already belongs to another account" });
      }
      user.email = lower(email);
    }

    await user.save();

    if (user.email !== oldEmail) {
      await renameAccountEmail(user, oldEmail, user.email);
      await writeAudit({ kind: "account", what: "Sign-in email changed", who: user.email, detail: `was ${oldEmail}`, user: user._id });
    }

    return res.json({ success: true, message: "Details saved", user: publicUser(user) });
  } catch (error) {
    console.error("Update me error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// CHANGE PASSWORD
// Signs out every other session (tokenVersion changes) and returns a fresh
// token for this one.
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const user = req.user;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new passwords are required" });
    }

    const min = MIN_PASSWORD[user.role] || 8;
    if (String(newPassword).length < min) {
      return res.status(400).json({ success: false, message: `New password must be at least ${min} characters` });
    }

    const ok = await bcrypt.compare(String(currentPassword), user.password);
    if (!ok) {
      return res.status(401).json({ success: false, code: "WRONG_PASSWORD", message: "Your current password is not right" });
    }

    user.password = await bcrypt.hash(String(newPassword), 10);
    user.tempPassword = false;
    user.passwordChangedAt = new Date();
    user.tokenVersion += 1;
    await user.save();

    await writeAudit({ kind: "account", what: "Password changed", who: user.email, user: user._id });

    return res.json({ success: true, message: "Password changed", token: generateToken(user) });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// DELETE MY ACCOUNT (and everything in it)
const deleteMe = async (req, res) => {
  try {
    const { password } = req.body || {};
    const user = req.user;

    if (!password) {
      return res.status(400).json({ success: false, message: "Enter your password to confirm" });
    }

    const ok = await bcrypt.compare(String(password), user.password);
    if (!ok) {
      return res.status(401).json({ success: false, code: "WRONG_PASSWORD", message: "That password is not right" });
    }

    if (user.role === "admin") {
      const otherAdmins = await User.countDocuments({ role: "admin", _id: { $ne: user._id }, status: "active" });
      if (!otherAdmins) {
        return res.status(409).json({
          success: false,
          message: "You are the only active administrator. Add another administrator before deleting this account.",
        });
      }
    }

    const email = user.email;
    await deleteAccountAndData(user);
    await writeAudit({ kind: "account", what: "Account deleted by its owner", who: email });

    return res.json({ success: true, message: "Account deleted" });
  } catch (error) {
    console.error("Delete me error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// FORGOT PASSWORD
// There is no email service, so this tells the administrators, who can give
// the person a temporary password from the Accounts tab. Always answers the
// same way so it can't be used to check which emails have accounts.
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!isEmail(email)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address" });
    }

    const user = await User.findOne({ email: lower(email) });
    if (user && user.role !== "student") {
      await writeAudit({ kind: "auth", what: "Password reset requested", who: user.email, user: user._id });
      await notifyAdmins({
        kind: "account",
        tone: "info",
        title: `Password reset requested — ${user.email}`,
        body: "Give them a temporary password from Accounts.",
        go: "accounts",
        tag: `reset-${user.email}`,
      });
    }

    return res.json({
      success: true,
      message: "If that email has an account, an administrator will be in touch with a temporary password.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  register,
  login,
  verifyAdminCode,
  getMe,
  logout,
  updateMe,
  changePassword,
  deleteMe,
  forgotPassword,
  MIN_PASSWORD,
};
