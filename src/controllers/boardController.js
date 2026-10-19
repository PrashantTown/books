const BoardPost = require("../models/BoardPost");
const { verdict } = require("../utils/moderation");
const { isAdmin, sameUser, ownerEmail, applyDecision } = require("../utils/access");
const { isClientId, text, ms } = require("../utils/validate");

/**
 * Parents' message board.
 *   GET    /api/community/board                 published posts + your own (admins: all)
 *   POST   /api/community/board                 write a post or a reply
 *   PATCH  /api/community/board/:id/moderation  admin: publish, remove or re-queue
 *   DELETE /api/community/board/:id             your own post, or any post as admin
 */

const BODY_MIN = 10;
const BODY_MAX = 600;

const postOut = (p) => ({
  id: p.clientId,
  from: p.fromName,
  owner: ownerEmail(p),
  body: p.body,
  ages: p.ages,
  at: ms(p.at),
  state: p.state,
  reason: p.reason,
  decidedBy: p.decidedBy,
  decidedAt: ms(p.decidedAt),
  parentId: p.parentClientId || "",
});

const listPosts = async (req, res) => {
  try {
    const query = isAdmin(req.user) ? {} : { $or: [{ state: "published" }, { owner: req.user._id }] };
    const posts = await BoardPost.find(query).sort({ at: -1 }).limit(500).populate("owner", "email");
    return res.json({ success: true, items: posts.map(postOut) });
  } catch (error) {
    console.error("List board error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const createPost = async (req, res) => {
  try {
    const { id, ages, parentId } = req.body || {};
    const body = text(req.body && req.body.body, BODY_MAX);
    const clientId = id || `bd-${Date.now().toString(36)}`;

    if (!isClientId(clientId)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (body.length < BODY_MIN) {
      return res.status(400).json({ success: false, message: `Write at least ${BODY_MIN} characters` });
    }

    const existing = await BoardPost.findOne({ clientId }).populate("owner", "email");
    if (existing) {
      // A retry of a post we already saved: answer with it instead of failing.
      if (sameUser(existing.owner, req.user)) return res.json({ success: true, item: postOut(existing) });
      return res.status(409).json({ success: false, message: "That id is already in use" });
    }

    if (parentId) {
      const parent = await BoardPost.findOne({ clientId: String(parentId) });
      if (!parent || (parent.state !== "published" && !sameUser(parent.owner, req.user))) {
        return res.status(404).json({ success: false, message: "The post you are replying to was not found" });
      }
    }

    const decision = await verdict(body, "");
    const post = await BoardPost.create({
      clientId,
      owner: req.user._id,
      fromName: text(req.user.name, 120) || "A parent",
      body,
      ages: text(ages, 20),
      parentClientId: parentId ? String(parentId) : "",
      state: decision === "approved" ? "published" : "pending",
      decidedBy: decision === "approved" ? "Automatic" : "",
      decidedAt: decision === "approved" ? new Date() : null,
      at: new Date(),
    });
    await post.populate("owner", "email");

    return res.status(201).json({ success: true, item: postOut(post) });
  } catch (error) {
    console.error("Create board post error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const moderatePost = async (req, res) => {
  try {
    const { state, reason } = req.body || {};
    if (!["published", "removed", "pending"].includes(state)) {
      return res.status(400).json({ success: false, message: "State must be published, removed or pending" });
    }
    if (state === "removed" && !String(reason || "").trim()) {
      return res.status(400).json({ success: false, message: "Give a reason when removing a post" });
    }

    const post = await BoardPost.findOne({ clientId: req.params.id }).populate("owner", "email");
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });

    applyDecision(post, state, reason, req.user, "removed");
    await post.save();

    return res.json({ success: true, item: postOut(post) });
  } catch (error) {
    console.error("Moderate board post error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const deletePost = async (req, res) => {
  try {
    const post = await BoardPost.findOne({ clientId: req.params.id });
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });
    if (!isAdmin(req.user) && !sameUser(post.owner, req.user)) {
      return res.status(403).json({ success: false, message: "You can only delete your own posts" });
    }

    // Replies go with the post they answer.
    await BoardPost.deleteMany({ $or: [{ _id: post._id }, { parentClientId: post.clientId }] });
    return res.json({ success: true, message: "Post deleted" });
  } catch (error) {
    console.error("Delete board post error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { listPosts, createPost, moderatePost, deletePost };
