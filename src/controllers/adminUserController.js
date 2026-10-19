const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Child = require("../models/Child");
const ShelfBook = require("../models/ShelfBook");
const ReadingLog = require("../models/ReadingLog");
const { writeAudit } = require("../utils/audit");
const { deleteAccountAndData } = require("../utils/accountCleanup");
const { isEmail, isObjectId, text, lower, ms } = require("../utils/validate");
const { MIN_PASSWORD } = require("./authController");

/** Count documents per owner, e.g. { "<userId>": 3 }. */
const countBy = async (Model, field, match = {}) => {
  const rows = await Model.aggregate([
    { $match: match },
    { $group: { _id: `$${field}`, n: { $sum: 1 } } },
  ]);
  const out = {};
  for (const row of rows) out[String(row._id)] = row.n;
  return out;
};

const accountRow = (user, counts) => {
  const id = String(user._id);
  return {
    id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    lockedOut: Boolean(user.lockedOut),
    tempPassword: Boolean(user.tempPassword),
    createdAt: ms(user.createdAt),
    lastSeen: ms(user.lastSeen),
    passwordChangedAt: ms(user.passwordChangedAt),
    shelf: counts
      ? {
          children: counts.children[id] || 0,
          books: counts.books[id] || 0,
          wishlist: counts.wishlist[id] || 0,
          sessions: counts.sessions[id] || 0,
        }
      : undefined,
  };
};

// GET /api/admin/users?role=parent|admin|student|all&status=&q=
const listUsers = async (req, res) => {
  try {
    const query = {};
    const role = String(req.query.role || "").toLowerCase();
    if (["parent", "admin", "student"].includes(role)) query.role = role;
    else if (role !== "all") query.role = { $in: ["parent", "admin"] };

    if (["active", "suspended"].includes(req.query.status)) query.status = req.query.status;

    if (req.query.q) {
      const safe = String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 100);
      query.$or = [{ name: { $regex: safe, $options: "i" } }, { email: { $regex: safe, $options: "i" } }];
    }

    const users = await User.find(query).sort({ createdAt: -1 });
    const [children, books, wishlist, sessions] = await Promise.all([
      countBy(Child, "parent"),
      countBy(ShelfBook, "owner", { list: "library" }),
      countBy(ShelfBook, "owner", { list: "wishlist" }),
      countBy(ReadingLog, "owner"),
    ]);

    return res.json({
      success: true,
      count: users.length,
      users: users.map((u) => accountRow(u, { children, books, wishlist, sessions })),
    });
  } catch (error) {
    console.error("List users error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /api/admin/users  { name, email, password, role: "parent"|"admin" }
const createUser = async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    const role = String((req.body && req.body.role) || "parent").toLowerCase();

    if (!["parent", "admin"].includes(role)) {
      return res.status(400).json({ success: false, message: "Role must be parent or admin" });
    }
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ success: false, message: "Name must be at least 2 characters" });
    }
    if (!isEmail(email)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address" });
    }
    if (!password || String(password).length < MIN_PASSWORD[role]) {
      return res.status(400).json({ success: false, message: `Password must be at least ${MIN_PASSWORD[role]} characters` });
    }
    if (await User.exists({ email: lower(email) })) {
      return res.status(409).json({ success: false, message: "User already exists" });
    }

    const user = await User.create({
      name: text(name, 120),
      email: lower(email),
      password: await bcrypt.hash(String(password), 10),
      role,
      tempPassword: true,
      passwordChangedAt: new Date(),
    });

    await writeAudit({
      kind: "account",
      what: `Created ${role === "admin" ? "an administrator" : "a parent"} account ${user.email}`,
      who: req.user.email,
      user: req.user._id,
    });

    return res.status(201).json({ success: true, user: accountRow(user) });
  } catch (error) {
    console.error("Create user error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const findTarget = async (req, res) => {
  if (!isObjectId(req.params.id)) {
    res.status(400).json({ success: false, message: "Invalid user ID" });
    return null;
  }
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404).json({ success: false, message: "User not found" });
    return null;
  }
  return user;
};

// PATCH /api/admin/users/:id/status  { status: "active"|"suspended" }
const setStatus = async (req, res) => {
  try {
    const status = req.body && req.body.status;
    if (!["active", "suspended"].includes(status)) {
      return res.status(400).json({ success: false, message: "Status must be active or suspended" });
    }

    const user = await findTarget(req, res);
    if (!user) return;

    if (String(user._id) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: "You can't change the status of your own account" });
    }

    const was = user.status;
    user.status = status;
    user.lockedOut = false;
    user.failedLogins = 0;
    if (status === "suspended" && was !== "suspended") user.tokenVersion += 1; // signs them out
    await user.save();

    return res.json({ success: true, user: accountRow(user) });
  } catch (error) {
    console.error("Set user status error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /api/admin/users/:id/temp-password  { password? }
// Sets a temporary password (the console generates one and shows it to the
// administrator), restores access and signs the person out everywhere.
const setTempPassword = async (req, res) => {
  try {
    const user = await findTarget(req, res);
    if (!user) return;

    let password = req.body && req.body.password ? String(req.body.password) : "";
    if (!password) password = crypto.randomBytes(9).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 12);

    const min = MIN_PASSWORD[user.role] || 8;
    if (password.length < Math.min(min, 8)) {
      return res.status(400).json({ success: false, message: "Temporary password must be at least 8 characters" });
    }

    user.password = await bcrypt.hash(password, 10);
    user.tempPassword = true;
    user.passwordChangedAt = new Date();
    user.status = "active";
    user.lockedOut = false;
    user.failedLogins = 0;
    user.tokenVersion += 1;
    await user.save();

    return res.json({ success: true, password, user: accountRow(user) });
  } catch (error) {
    console.error("Temp password error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// DELETE /api/admin/users/:id
const deleteUser = async (req, res) => {
  try {
    const user = await findTarget(req, res);
    if (!user) return;

    if (String(user._id) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: "Delete your own account from Settings instead" });
    }

    const email = user.email;
    await deleteAccountAndData(user);
    await writeAudit({ kind: "account", what: `Deleted the account ${email}`, who: req.user.email, user: req.user._id });

    return res.json({ success: true, message: "Account deleted" });
  } catch (error) {
    console.error("Delete user error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { listUsers, createUser, setStatus, setTempPassword, deleteUser };
