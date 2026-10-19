const Suggestion = require("../models/Suggestion");
const { verdict } = require("../utils/moderation");
const { isAdmin, sameUser, ownerEmail, applyDecision } = require("../utils/access");
const { isClientId, text, ms } = require("../utils/validate");

/**
 * Resources suggested by parents. Approved ones appear on everyone's
 * Resources tab as "Suggested by a parent".
 *   GET    /api/community/suggestions                  your own + approved (admins: all)
 *   POST   /api/community/suggestions                  suggest a resource
 *   PATCH  /api/community/suggestions/:id/moderation   admin: approve, reject or re-queue
 *   DELETE /api/community/suggestions/:id              your own, or any as admin
 */

const suggestionOut = (s) => ({
  id: s.clientId,
  origin: s.origin === "seed" ? "seed" : "parent",
  title: s.title,
  body: s.body,
  link: s.link,
  category: s.category,
  ages: s.ages,
  from: s.fromName,
  owner: ownerEmail(s),
  at: ms(s.at),
  state: s.state,
  reason: s.reason,
  decidedBy: s.decidedBy,
  decidedAt: ms(s.decidedAt),
});

const validLink = (link) => {
  if (!link) return true;
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    return false;
  }
};

const listSuggestions = async (req, res) => {
  try {
    const query = isAdmin(req.user) ? {} : { $or: [{ state: "approved" }, { owner: req.user._id }] };
    const items = await Suggestion.find(query).sort({ at: -1 }).limit(1000).populate("owner", "email");
    return res.json({ success: true, items: items.map(suggestionOut) });
  } catch (error) {
    console.error("List suggestions error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const createSuggestion = async (req, res) => {
  try {
    const b = req.body || {};
    const clientId = b.id || `psub-${Date.now().toString(36)}`;
    const title = text(b.title, 200);
    const body = text(b.body, 2000);
    const link = text(b.link, 2000);

    if (!isClientId(clientId)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!title) return res.status(400).json({ success: false, message: "Give the suggestion a title" });
    if (!validLink(link)) return res.status(400).json({ success: false, message: "The link must start with http:// or https://" });

    const existing = await Suggestion.findOne({ clientId }).populate("owner", "email");
    if (existing) {
      if (sameUser(existing.owner, req.user)) return res.json({ success: true, item: suggestionOut(existing) });
      return res.status(409).json({ success: false, message: "That id is already in use" });
    }

    const decision = await verdict(`${title} ${body}`, link);
    const suggestion = await Suggestion.create({
      clientId,
      owner: req.user._id,
      fromName: text(req.user.name, 120) || "A parent",
      origin: "parent",
      title,
      body,
      link,
      category: text(b.category, 40),
      ages: text(b.ages, 20),
      at: new Date(),
      state: decision === "approved" ? "approved" : "pending",
      decidedBy: decision === "approved" ? "Automatic" : "",
      decidedAt: decision === "approved" ? new Date() : null,
    });
    await suggestion.populate("owner", "email");

    return res.status(201).json({ success: true, item: suggestionOut(suggestion) });
  } catch (error) {
    console.error("Create suggestion error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const moderateSuggestion = async (req, res) => {
  try {
    const { state, reason } = req.body || {};
    if (!["approved", "rejected", "pending"].includes(state)) {
      return res.status(400).json({ success: false, message: "State must be approved, rejected or pending" });
    }

    const suggestion = await Suggestion.findOne({ clientId: req.params.id }).populate("owner", "email");
    if (!suggestion) return res.status(404).json({ success: false, message: "Suggestion not found" });

    applyDecision(suggestion, state, reason, req.user, "rejected");
    await suggestion.save();
    return res.json({ success: true, item: suggestionOut(suggestion) });
  } catch (error) {
    console.error("Moderate suggestion error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const deleteSuggestion = async (req, res) => {
  try {
    const suggestion = await Suggestion.findOne({ clientId: req.params.id });
    if (!suggestion) return res.status(404).json({ success: false, message: "Suggestion not found" });
    if (!isAdmin(req.user) && !sameUser(suggestion.owner, req.user)) {
      return res.status(403).json({ success: false, message: "You can only delete your own suggestions" });
    }
    await suggestion.deleteOne();
    return res.json({ success: true, message: "Suggestion deleted" });
  } catch (error) {
    console.error("Delete suggestion error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { listSuggestions, createSuggestion, moderateSuggestion, deleteSuggestion };
