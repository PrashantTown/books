const ShareLink = require("../models/ShareLink");
const { text, ms, randomToken } = require("../utils/validate");

/**
 * Read-only wishlist links.
 *   GET    /api/share/mine      your link, if you have one
 *   PUT    /api/share/mine      create or update it (snapshot, expiry, privacy)
 *   DELETE /api/share/mine      turn sharing off
 *   GET    /api/share/:token    PUBLIC: open a shared wishlist
 */

const TOKEN = /^[a-z0-9]{10,40}$/;

const expiresFor = (created, expiry) => {
  const days = { 7: 7, 30: 30 }[String(expiry)];
  return days ? new Date(created.getTime() + days * 864e5) : null;
};

const shareOut = (s, ownerEmail) => ({
  token: s.token,
  owner: ownerEmail || undefined,
  ownerName: s.ownerName,
  scope: s.scope,
  initials: s.initials,
  expiry: s.expiry,
  created: ms(s.created),
  expires: ms(s.expires),
  updated: ms(s.updated),
  items: (s.items || []).map((i) => ({
    title: i.title,
    author: i.author,
    catName: i.catName,
    ages: i.ages,
    spine: i.spine,
    forNames: i.forNames || [],
  })),
});

const cleanItems = (items) =>
  (Array.isArray(items) ? items : []).slice(0, 500).map((i) => ({
    title: text(i && i.title, 300),
    author: text(i && i.author, 300),
    catName: text(i && i.catName, 80),
    ages: text(i && i.ages, 20),
    spine: /^#[0-9a-fA-F]{6}$/.test(String(i && i.spine)) ? i.spine : "#2F6E86",
    forNames: Array.isArray(i && i.forNames) ? i.forNames.slice(0, 20).map((n) => text(n, 60)) : [],
  }));

const getMine = async (req, res) => {
  try {
    const share = await ShareLink.findOne({ owner: req.user._id });
    return res.json({ success: true, item: share ? shareOut(share, req.user.email) : null });
  } catch (error) {
    console.error("Get share link error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const putMine = async (req, res) => {
  try {
    const b = req.body || {};
    let share = await ShareLink.findOne({ owner: req.user._id });

    if (!share) {
      let token = TOKEN.test(String(b.token || "")) ? String(b.token) : randomToken(14);
      if (await ShareLink.exists({ token })) token = randomToken(14);
      share = new ShareLink({ token, owner: req.user._id, created: new Date() });
    }

    share.ownerName = text(b.ownerName !== undefined ? b.ownerName : req.user.name, 120);
    share.scope = b.scope === "invite" ? "invite" : "link";
    share.initials = Boolean(b.initials);
    share.expiry = ["7", "30", "never"].includes(String(b.expiry)) ? String(b.expiry) : share.expiry || "30";
    share.expires = expiresFor(share.created, share.expiry);
    share.items = cleanItems(b.items);
    share.updated = new Date();
    await share.save();

    return res.json({ success: true, item: shareOut(share, req.user.email) });
  } catch (error) {
    console.error("Save share link error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const deleteMine = async (req, res) => {
  try {
    await ShareLink.deleteOne({ owner: req.user._id });
    return res.json({ success: true, message: "Sharing turned off" });
  } catch (error) {
    console.error("Delete share link error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const openShared = async (req, res) => {
  try {
    const token = String(req.params.token || "");
    const share = TOKEN.test(token) ? await ShareLink.findOne({ token }) : null;
    if (!share) return res.status(404).json({ success: false, code: "NOT_FOUND", message: "This link doesn't open anything" });
    if (share.expires && share.expires.getTime() < Date.now()) {
      return res.status(410).json({ success: false, code: "EXPIRED", message: "This link has expired", expires: ms(share.expires) });
    }
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, item: shareOut(share) });
  } catch (error) {
    console.error("Open shared wishlist error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getMine, putMine, deleteMine, openShared };
