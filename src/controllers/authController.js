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
const { sendMail, mailEnabled } = require("../utils/mailer");

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

    // Create user. With email set up, the account waits until the person
    // opens the confirmation link we email them.
    const confirmByEmail = mailEnabled();
    const user = await User.create({
      name: text(name, 120),
      email: lower(email),
      password: hashedPassword,
      role: "parent",
      lastSeen: new Date(),
      passwordChangedAt: new Date(),
      emailConfirmed: !confirmByEmail,
    });

    await writeAudit({ kind: "auth", what: "Parent account created", who: user.email, user: user._id });

    if (confirmByEmail) {
      await startConfirmation(user, req);
      return res.status(201).json({
        success: true,
        confirm: true,
        message: `We've sent a link to ${user.email}. Open it to finish creating your account.`,
      });
    }

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

const issueChallenge = (user, minutes = 5) => {
  const jti = crypto.randomBytes(12).toString("hex");
  return jwt.sign(
    { userId: user._id, tokenVersion: user.tokenVersion, purpose: "admin-code", jti },
    process.env.JWT_SECRET,
    { expiresIn: `${minutes}m` }
  );
};

// With email set up, each administrator sign-in gets its own six-digit code,
// emailed to the address they sign in with. Without email, everyone uses the
// shared ADMIN_LOGIN_CODE (if it is set).
const ADMIN_EMAIL_CODE_MINUTES = 10;

const maskEmail = (email) => {
  const [name, domain] = String(email || "").split("@");
  return `${name.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(6, name.length - 1)))}@${domain}`;
};

const sendAdminCodeEmail = (user, code) => {
  const text = [
    `Hi ${user.name || "there"},`,
    "",
    `Your code to finish signing in to the Parents Go To console is: ${code}`,
    "",
    `It works once and stops working after ${ADMIN_EMAIL_CODE_MINUTES} minutes.`,
    "If you didn't just try to sign in, someone may know your password: change it in Settings straight away.",
    "",
    "Parents Go To",
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1d2a26;max-width:520px">
<p>Hi ${escapeHtml(user.name || "there")},</p>
<p>Your code to finish signing in to the Parents Go To console is:</p>
<p style="font-size:30px;font-weight:bold;letter-spacing:6px;margin:16px 0">${escapeHtml(code)}</p>
<p style="font-size:14px;color:#4b5a55">It works once and stops working after ${ADMIN_EMAIL_CODE_MINUTES} minutes. If you didn't just try to sign in, someone may know your password: change it in Settings straight away.</p>
<p>Parents Go To</p></div>`;
  return sendMail({ to: user.email, subject: `${code} is your Parents Go To sign-in code`, text, html });
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

    if (user.emailConfirmed === false) {
      await user.save();
      return res.status(403).json({
        success: false,
        code: "EMAIL_NOT_CONFIRMED",
        message: "Your email address is not confirmed yet. Open the link we emailed you, or ask for a new one.",
      });
    }

    if (user.role === "admin" && mailEnabled()) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      user.adminCodeHash = hashToken(`${user._id}:${code}`);
      user.adminCodeExpires = new Date(Date.now() + ADMIN_EMAIL_CODE_MINUTES * 60 * 1000);
      await user.save();
      try {
        await sendAdminCodeEmail(user, code);
      } catch (error) {
        console.error("Admin code email error:", error.message);
        return res.status(503).json({
          success: false,
          code: "EMAIL_FAILED",
          message: "We couldn't email your sign-in code just now. Try again in a minute.",
        });
      }
      return res.json({
        success: true,
        codeRequired: true,
        via: "email",
        sentTo: maskEmail(user.email),
        challenge: issueChallenge(user, ADMIN_EMAIL_CODE_MINUTES),
        message: "We've emailed you a six-digit code",
      });
    }

    if (user.role === "admin" && adminCodeRequired()) {
      await user.save();
      return res.json({
        success: true,
        codeRequired: true,
        via: "code",
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

    // The code we emailed this administrator, or else the shared code.
    let right;
    if (user.adminCodeHash) {
      if (!user.adminCodeExpires || user.adminCodeExpires.getTime() < Date.now()) {
        return res.status(401).json({ success: false, code: "CHALLENGE_EXPIRED", message: "That code has expired. Go back and sign in again for a new one." });
      }
      right = sameCode(hashToken(`${user._id}:${String(code).trim()}`), user.adminCodeHash);
    } else {
      right = adminCodeRequired() && sameCode(String(code).trim(), String(process.env.ADMIN_LOGIN_CODE || "").trim());
    }

    if (!right) {
      entry.fails += 1;
      if (entry.fails >= ADMIN_CODE_TRIES) {
        entry.done = true;
        usedChallenges.set(decoded.jti, entry);
        if (user.adminCodeHash) {
          user.adminCodeHash = null;
          user.adminCodeExpires = null;
          await user.save();
        }
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

    user.adminCodeHash = null;
    user.adminCodeExpires = null;
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
    user.resetTokenHash = null;
    user.resetTokenExpires = null;
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

// CHECK MY PASSWORD
// Settings asks for the current password before sensitive changes (new email,
// new password, deleting the account). Nothing changes here, and a wrong
// password doesn't count towards the lockout; the route is rate-limited.
const verifyPassword = async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ success: false, message: "Enter your password" });
    }
    const valid = await bcrypt.compare(String(password), req.user.password);
    return res.json({ success: true, valid });
  } catch (error) {
    console.error("Verify password error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// SIGN OUT EVERYWHERE ELSE
// Ends every other session (tokenVersion changes) and returns a fresh token,
// so this device stays signed in.
const logoutOthers = async (req, res) => {
  try {
    const user = req.user;
    user.tokenVersion += 1;
    await user.save();
    await writeAudit({ kind: "auth", what: "Signed out on every other device", who: user.email, user: user._id });
    return res.json({ success: true, message: "Signed out everywhere else", token: generateToken(user) });
  } catch (error) {
    console.error("Logout others error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// FORGOT PASSWORD
// With email set up (src/utils/mailer.js), this emails a one-time link to
// choose a new password; without it, the administrators are told and can
// give the person a temporary password from the Accounts tab. Either way the
// answer is the same whether or not the email has an account.
const RESET_MINUTES = 30;
const RESET_RESEND_SECONDS = 60;
const RESET_PAGE = "/reading-for-pleasure.html";

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

const escapeHtml = (value) =>
  String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Where the emailed link points: the site the request came from when it is
// one of the allowed sites (CORS_ORIGINS), otherwise SITE_URL, otherwise the
// first allowed site.
const resetPageFor = (req) => {
  const allowed = String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const origin = String(req.get("origin") || "").replace(/\/$/, "");
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (origin && (allowed.includes(origin) || (!allowed.length && local))) return origin + RESET_PAGE;
  const site = String(process.env.SITE_URL || "").trim().replace(/\/$/, "");
  if (site) return /\.html$/.test(site) ? site : site + RESET_PAGE;
  return (allowed[0] || "http://localhost:5500") + RESET_PAGE;
};

const sendResetEmail = (user, link) => {
  const name = user.name || "there";
  const text = [
    `Hi ${name},`,
    "",
    `Someone asked to reset the password for your Parents Go To account (${user.email}). If it was you, open this link to choose a new password:`,
    "",
    link,
    "",
    `The link works once and stops working after ${RESET_MINUTES} minutes. If you didn't ask, you can ignore this email: your password stays the same.`,
    "",
    "Parents Go To",
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1d2a26;max-width:520px">
<p>Hi ${escapeHtml(name)},</p>
<p>Someone asked to reset the password for your Parents Go To account (${escapeHtml(user.email)}). If it was you, choose a new password here:</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0D3B32;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Choose a new password</a></p>
<p style="font-size:14px;color:#4b5a55">Or copy this address into your browser:<br>${escapeHtml(link)}</p>
<p style="font-size:14px;color:#4b5a55">The link works once and stops working after ${RESET_MINUTES} minutes. If you didn't ask, you can ignore this email: your password stays the same.</p>
<p>Parents Go To</p></div>`;
  return sendMail({ to: user.email, subject: "Reset your Parents Go To password", text, html });
};

const tellAdmins = (user, why) =>
  notifyAdmins({
    kind: "account",
    tone: "info",
    title: `Password reset requested — ${user.email}`,
    body: why || "Give them a temporary password from Accounts.",
    go: "accounts",
    tag: `reset-${user.email}`,
  });

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!isEmail(email)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address" });
    }

    const byEmail = mailEnabled();
    const user = await User.findOne({ email: lower(email) });
    if (user && user.role !== "student") {
      if (!byEmail) {
        await writeAudit({ kind: "auth", what: "Password reset requested", who: user.email, user: user._id });
        await tellAdmins(user);
      } else if (!user.resetRequestedAt || Date.now() - user.resetRequestedAt.getTime() > RESET_RESEND_SECONDS * 1000) {
        const token = crypto.randomBytes(32).toString("hex");
        user.resetTokenHash = hashToken(token);
        user.resetTokenExpires = new Date(Date.now() + RESET_MINUTES * 60 * 1000);
        user.resetRequestedAt = new Date();
        await user.save();
        // Not awaited, so the answer takes as long whether or not the email
        // has an account. If sending fails, the administrators are told.
        sendResetEmail(user, `${resetPageFor(req)}#reset=${token}`)
          .then(() => writeAudit({ kind: "auth", what: "Password reset email sent", who: user.email, user: user._id }))
          .catch(async (error) => {
            console.error("Reset email error:", error.message);
            try {
              await writeAudit({ kind: "auth", what: "Password reset email could not be sent", who: user.email, detail: error.message.slice(0, 200), user: user._id });
              await tellAdmins(user, "The reset email could not be sent. Give them a temporary password from Accounts.");
            } catch (e) {
              console.error("Reset email fallback error:", e.message);
            }
          });
      }
    }

    return res.json({
      success: true,
      mode: byEmail ? "email" : "admin",
      message: byEmail
        ? "If that email has an account, we've sent a link to choose a new password."
        : "If that email has an account, an administrator will be in touch with a temporary password.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// RESET PASSWORD (from the emailed link)
// Body { token, password }. The link works once, for 30 minutes. It also
// lifts a lockout from too many wrong passwords (the person has shown they
// own the inbox), but not a suspension by an administrator. Every other
// session is signed out. Parents are signed in straight away; administrators
// sign in again, so the administrator code is still needed.
const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ success: false, message: "Choose a new password" });
    }

    const user = await User.findOne({ resetTokenHash: hashToken(token), resetTokenExpires: { $gt: new Date() } });
    if (!user) {
      return res.status(400).json({
        success: false,
        code: "RESET_EXPIRED",
        message: "That reset link has expired or has already been used. Ask for a new one.",
      });
    }

    const min = MIN_PASSWORD[user.role] || 8;
    if (String(password).length < min) {
      return res.status(400).json({ success: false, message: `Your new password needs at least ${min} characters` });
    }
    if (user.status === "suspended" && !user.lockedOut) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_SUSPENDED",
        message: "That account has been suspended by an administrator",
      });
    }

    user.password = await bcrypt.hash(String(password), 10);
    user.tempPassword = false;
    user.passwordChangedAt = new Date();
    user.failedLogins = 0;
    if (user.lockedOut) {
      user.lockedOut = false;
      user.status = "active";
    }
    user.resetTokenHash = null;
    user.resetTokenExpires = null;
    user.tokenVersion += 1;
    if (user.role !== "admin") user.lastSeen = new Date();
    await user.save();

    await writeAudit({ kind: "auth", what: "Password reset with an emailed link", who: user.email, user: user._id });

    if (user.role === "admin") {
      return res.json({ success: true, signIn: true, message: "Password changed. Sign in with it as an administrator." });
    }
    return res.json({ success: true, message: "Password changed", token: generateToken(user), user: publicUser(user) });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// CONFIRM EMAIL (new accounts, when email is set up)
const CONFIRM_HOURS = 24;

const sendConfirmEmail = (user, link) => {
  const name = user.name || "there";
  const text = [
    `Hi ${name},`,
    "",
    `Welcome to Parents Go To. Please confirm your email address (${user.email}) to finish creating your account:`,
    "",
    link,
    "",
    `The link works once and stops working after ${CONFIRM_HOURS} hours. If you didn't sign up, you can ignore this email and the account won't be used.`,
    "",
    "Parents Go To",
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1d2a26;max-width:520px">
<p>Hi ${escapeHtml(name)},</p>
<p>Welcome to Parents Go To. Please confirm your email address (${escapeHtml(user.email)}) to finish creating your account:</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0D3B32;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Confirm my email</a></p>
<p style="font-size:14px;color:#4b5a55">Or copy this address into your browser:<br>${escapeHtml(link)}</p>
<p style="font-size:14px;color:#4b5a55">The link works once and stops working after ${CONFIRM_HOURS} hours. If you didn't sign up, you can ignore this email and the account won't be used.</p>
<p>Parents Go To</p></div>`;
  return sendMail({ to: user.email, subject: "Confirm your email for Parents Go To", text, html });
};

// A new link (replacing any older one), emailed without waiting for it.
const startConfirmation = async (user, req) => {
  const token = crypto.randomBytes(32).toString("hex");
  user.confirmTokenHash = hashToken(token);
  user.confirmTokenExpires = new Date(Date.now() + CONFIRM_HOURS * 60 * 60 * 1000);
  user.confirmSentAt = new Date();
  await user.save();
  sendConfirmEmail(user, `${resetPageFor(req)}#confirm=${token}`).catch((error) => {
    console.error("Confirmation email error:", error.message);
    writeAudit({ kind: "auth", what: "Confirmation email could not be sent", who: user.email, detail: error.message.slice(0, 200), user: user._id }).catch(() => {});
  });
};

// POST /api/auth/confirm-email  { token } -> signs the person in
const confirmEmail = async (req, res) => {
  try {
    const { token } = req.body || {};
    const user = token
      ? await User.findOne({ confirmTokenHash: hashToken(token), confirmTokenExpires: { $gt: new Date() } })
      : null;
    if (!user) {
      return res.status(400).json({
        success: false,
        code: "CONFIRM_EXPIRED",
        message: "That confirmation link has expired or has already been used. Sign in to get a new one.",
      });
    }
    if (user.status === "suspended") {
      return res.status(403).json({ success: false, code: "ACCOUNT_SUSPENDED", message: "Your account has been suspended" });
    }
    user.emailConfirmed = true;
    user.confirmTokenHash = null;
    user.confirmTokenExpires = null;
    user.lastSeen = new Date();
    await user.save();
    await writeAudit({ kind: "auth", what: "Email address confirmed", who: user.email, user: user._id });
    return res.json({ success: true, message: "Email confirmed", token: generateToken(user), user: publicUser(user) });
  } catch (error) {
    console.error("Confirm email error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /api/auth/resend-confirmation  { email } — same answer for any email
const resendConfirmation = async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!isEmail(email)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address" });
    }
    if (mailEnabled()) {
      const user = await User.findOne({ email: lower(email) });
      const recent = user && user.confirmSentAt && Date.now() - user.confirmSentAt.getTime() < RESET_RESEND_SECONDS * 1000;
      if (user && user.emailConfirmed === false && !recent) await startConfirmation(user, req);
    }
    return res.json({ success: true, message: "If that account still needs confirming, we've sent a new link." });
  } catch (error) {
    console.error("Resend confirmation error:", error);
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
  resetPassword,
  confirmEmail,
  resendConfirmation,
  verifyPassword,
  logoutOthers,
  MIN_PASSWORD,
};
