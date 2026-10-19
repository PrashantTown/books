const CarerInvite = require("../models/CarerInvite");
const User = require("../models/User");
const { createNotification } = require("../utils/notify");
const { writeAudit } = require("../utils/audit");
const { sameUser } = require("../utils/access");
const { isClientId, isEmail, text, lower, ms, randomToken } = require("../utils/validate");

/**
 * Sharing a family shelf with carers.
 *   GET  /api/family               invitations you sent, and ones sent to you
 *   POST /api/family               invite someone by email
 *   POST /api/family/:id/accept    accept an invitation sent to your email
 *   POST /api/family/:id/withdraw  withdraw one you sent (or leave one you accepted)
 *
 * Accepted carers can chat with the shelf owner (see /api/chat).
 */

const MAX_ACTIVE = 12;

const inviteOut = (r, user) => ({
  id: r.clientId,
  ref: r.ref,
  owner: r.owner && r.owner.email ? r.owner.email : "",
  name: r.name,
  email: r.email,
  role: r.role,
  state: r.state,
  by: r.by,
  byName: r.byName,
  at: ms(r.at),
  acceptedAt: ms(r.acceptedAt),
  withdrawnAt: ms(r.withdrawnAt),
  withdrawnBy: r.withdrawnBy,
  // True when this invitation was sent to the person asking, not by them.
  incoming: user ? !sameUser(r.owner, user) : undefined,
});

const listInvites = async (req, res) => {
  try {
    const invites = await CarerInvite.find({
      $or: [{ owner: req.user._id }, { email: req.user.email, state: { $in: ["invited", "accepted"] } }],
    })
      .sort({ at: -1 })
      .populate("owner", "email name");
    return res.json({ success: true, items: invites.map((r) => inviteOut(r, req.user)) });
  } catch (error) {
    console.error("List carer invites error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const invite = async (req, res) => {
  try {
    const b = req.body || {};
    const clientId = b.id || `fam-${randomToken(8)}`;
    const email = lower(b.email);

    if (!isClientId(clientId)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!isEmail(email)) return res.status(400).json({ success: false, message: "Enter a valid email address" });
    if (email === req.user.email) return res.status(400).json({ success: false, message: "You can't invite yourself" });

    const existing = await CarerInvite.findOne({ clientId }).populate("owner", "email name");
    if (existing) {
      if (sameUser(existing.owner, req.user)) return res.json({ success: true, item: inviteOut(existing, req.user) });
      return res.status(409).json({ success: false, message: "That id is already in use" });
    }

    const active = await CarerInvite.find({ owner: req.user._id, state: { $in: ["invited", "accepted"] } });
    if (active.some((r) => r.email === email)) {
      return res.status(409).json({ success: false, message: "That person already has access or an invitation" });
    }
    if (active.length >= MAX_ACTIVE) {
      return res.status(400).json({ success: false, message: `You can share with at most ${MAX_ACTIVE} people` });
    }

    const row = await CarerInvite.create({
      clientId,
      ref: /^PTG-F[A-Z0-9]{2,8}$/.test(String(b.ref || "")) ? b.ref : `PTG-F${randomToken(4).toUpperCase()}`,
      owner: req.user._id,
      name: text(b.name, 120),
      email,
      by: req.user.email,
      byName: text(req.user.name, 120),
      at: new Date(),
    });
    await row.populate("owner", "email name");

    if (await User.exists({ email, role: "parent" })) {
      await createNotification({
        to: `parent::${email}`,
        kind: "account",
        tone: "info",
        title: `${req.user.name || req.user.email} invited you to their family shelf`,
        body: "Open the invitation to accept it and chat with them about what the children are reading.",
        go: "",
        tag: `invite-${row.clientId}`,
        createdBy: req.user._id,
      });
    }

    return res.status(201).json({ success: true, item: inviteOut(row, req.user) });
  } catch (error) {
    console.error("Invite carer error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const accept = async (req, res) => {
  try {
    const row = await CarerInvite.findOne({ clientId: req.params.id }).populate("owner", "email name");
    if (!row || row.email !== req.user.email) {
      return res.status(404).json({ success: false, message: "Invitation not found" });
    }
    if (row.state !== "invited") {
      return res.status(409).json({ success: false, message: `This invitation is already ${row.state}` });
    }

    row.state = "accepted";
    row.acceptedAt = new Date();
    row.carer = req.user._id;
    await row.save();

    if (row.owner && row.owner.email) {
      await createNotification({
        to: `parent::${row.owner.email}`,
        kind: "account",
        tone: "good",
        title: `${req.user.name || req.user.email} accepted your invitation`,
        body: "You can now message them from the share dialog.",
        go: "",
        tag: `invite-${row.clientId}`,
        createdBy: req.user._id,
      });
    }
    await writeAudit({ kind: "account", what: "Accepted a shelf invitation", who: req.user.email, detail: row.ref, user: req.user._id });

    return res.json({ success: true, item: inviteOut(row, req.user) });
  } catch (error) {
    console.error("Accept invite error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const withdraw = async (req, res) => {
  try {
    const row = await CarerInvite.findOne({ clientId: req.params.id }).populate("owner", "email name");
    if (!row) return res.status(404).json({ success: false, message: "Invitation not found" });

    const isOwner = sameUser(row.owner, req.user);
    const isInvitee = row.email === req.user.email;
    if (!isOwner && !isInvitee) return res.status(404).json({ success: false, message: "Invitation not found" });

    if (row.state !== "withdrawn") {
      row.state = "withdrawn";
      row.withdrawnAt = new Date();
      row.withdrawnBy = req.user.email;
      await row.save();
    }
    return res.json({ success: true, item: inviteOut(row, req.user) });
  } catch (error) {
    console.error("Withdraw invite error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { listInvites, invite, accept, withdraw };
