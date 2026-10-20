const CarerInvite = require("../models/CarerInvite");
const User = require("../models/User");
const { createNotification } = require("../utils/notify");
const { writeAudit } = require("../utils/audit");
const { sameUser } = require("../utils/access");
const { isClientId, isEmail, text, lower, ms, randomToken } = require("../utils/validate");
const { buildShelf } = require("./shelfController");
const { sendMail, mailEnabled } = require("../utils/mailer");
const { sitePage } = require("../utils/siteLink");
const { escapeHtml } = require("../utils/tokens");

// The invitation by email: how to join, with a link that opens "Create an
// account" with their email filled in. Accepting happens on the site.
const sendInviteEmail = (row, inviter, req) => {
  const from = inviter.name || inviter.email;
  const link = `${sitePage(req)}?view=create&invite=${encodeURIComponent(row.email)}`;
  const text = [
    `Hi ${row.name || "there"},`,
    "",
    `${from} has invited you to join their family reading shelf on Parents Go To, so you can see what the children are reading and chat with the family.`,
    "",
    `Create a free account, or sign in if you have one, using this email address: ${row.email}`,
    link,
    "",
    `Once you're signed in, you'll be asked to accept the invitation. Your invitation code is ${row.ref}.`,
    "",
    "Parents Go To",
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1d2a26;max-width:520px">
<p>Hi ${escapeHtml(row.name || "there")},</p>
<p><b>${escapeHtml(from)}</b> has invited you to join their family reading shelf on Parents Go To, so you can see what the children are reading and chat with the family.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0D3B32;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Join the family shelf</a></p>
<p style="font-size:14px;color:#4b5a55">Create a free account, or sign in if you have one, with <b>${escapeHtml(row.email)}</b>. Once you're signed in you'll be asked to accept. Invitation code: ${escapeHtml(row.ref)}.</p>
<p>Parents Go To</p></div>`;
  return sendMail({ to: row.email, subject: `${from} invited you to their family reading shelf`, text, html, replyTo: inviter.email });
};

/**
 * Sharing a family shelf with carers.
 *   GET  /api/family               invitations you sent, and ones sent to you
 *   POST /api/family               invite someone by email
 *   POST /api/family/:id/accept    accept an invitation sent to your email
 *   POST /api/family/:id/withdraw  withdraw one you sent (or leave one you accepted)
 *   GET  /api/family/shared        the shelves shared with you (read-only copies)
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

    // Email the invitation too (when email is set up), so they can join even
    // without an account yet.
    let emailed = false;
    if (mailEnabled()) {
      try {
        await sendInviteEmail(row, req.user, req);
        emailed = true;
      } catch (error) {
        console.error("Invitation email error:", error.message);
      }
    }

    return res.status(201).json({ success: true, emailed, item: inviteOut(row, req.user) });
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

// GET /api/family/shared
// The shelves of the families whose invitation you accepted: children,
// library, wishlist and recent reading, to look at but not change.
const SHARED_SESSIONS = 200;
const sharedShelves = async (req, res) => {
  try {
    const rows = await CarerInvite.find({
      state: "accepted",
      $or: [{ carer: req.user._id }, { email: req.user.email }],
    })
      .sort({ acceptedAt: -1 })
      .limit(MAX_ACTIVE)
      .populate("owner", "email name role status");

    const items = [];
    for (const row of rows) {
      const owner = row.owner;
      if (!owner || owner.role !== "parent" || owner.status === "suspended" || sameUser(owner, req.user)) continue;
      const shelf = await buildShelf(owner);
      items.push({
        ownerId: String(owner._id),
        ownerName: owner.name || owner.email,
        ownerEmail: owner.email,
        linkId: row.clientId,
        acceptedAt: ms(row.acceptedAt),
        children: shelf.children,
        books: shelf.books,
        wishlist: shelf.wishlist,
        sessions: shelf.sessions.slice(0, SHARED_SESSIONS),
      });
    }
    return res.json({ success: true, items });
  } catch (error) {
    console.error("Shared shelves error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { listInvites, invite, accept, withdraw, sharedShelves };
