const ChatThread = require("../models/ChatThread");
const ChatMessage = require("../models/ChatMessage");
const ChatRead = require("../models/ChatRead");
const CarerInvite = require("../models/CarerInvite");
const User = require("../models/User");
const { isClientId, text, ms, randomToken } = require("../utils/validate");

/**
 * Chat between a parent and their children's profiles ("family") and
 * between a parent and an accepted carer ("shelf").
 *
 *   GET    /api/chat                           threads, messages and read markers you can see
 *   POST   /api/chat/threads                   open a thread (returns the existing one if the key matches)
 *   POST   /api/chat/threads/:id/messages      send a message
 *   PUT    /api/chat/threads/:id/read          mark read up to a time
 *   PATCH  /api/chat/threads/:id               open / close
 *   DELETE /api/chat/threads/:id               delete a thread
 *
 * Member ids are the frontend's: "mail:<email>" for an adult and
 * "kid:<parent email>:<child id>" for a child's profile on that parent's shelf.
 */

const MSG_MAX = 500;

const adult = (email) => `mail:${String(email).toLowerCase()}`;
const controls = (user, member) => {
  const id = String(member || "");
  return id === adult(user.email) || id.startsWith(`kid:${String(user.email).toLowerCase()}:`);
};

const visible = (user) => ({
  $or: [{ memberUsers: user._id }, { kind: "family", account: String(user.email).toLowerCase() }],
});

const canSee = (thread, user) =>
  (thread.memberUsers || []).some((id) => String(id) === String(user._id)) ||
  (thread.kind === "family" && thread.account === String(user.email).toLowerCase());

// Stored names [{ member, name }] -> the frontend's { memberId: name }.
const namesMap = (t) => {
  const out = {};
  for (const entry of t.names || []) out[entry.member] = entry.name;
  return out;
};

const threadOut = (t) => ({
  id: t.clientId,
  key: t.key,
  kind: t.kind,
  title: t.title,
  account: t.account,
  members: t.members,
  names: namesMap(t),
  state: t.state,
  at: ms(t.at),
  createdAt: ms(t.startedAt),
});

const messageOut = (m) => ({
  id: m.clientId,
  thread: m.thread,
  from: m.from,
  name: m.name,
  body: m.body,
  at: ms(m.at),
});

const cleanNames = (names, members) => {
  const out = [];
  if (names && typeof names === "object") {
    for (const member of members) {
      if (names[member] !== undefined) out.push({ member, name: text(names[member], 120) });
    }
  }
  return out;
};

// GET /api/chat
const getChat = async (req, res) => {
  try {
    const threads = await ChatThread.find(visible(req.user)).sort({ at: -1 }).limit(200);
    const ids = threads.map((t) => t.clientId);

    const msgs = {};
    if (ids.length) {
      const all = await ChatMessage.find({ thread: { $in: ids } }).sort({ at: 1 });
      for (const m of all) (msgs[m.thread] = msgs[m.thread] || []).push(messageOut(m));
      for (const id of Object.keys(msgs)) msgs[id] = msgs[id].slice(-MSG_MAX);
    }

    const reads = {};
    const markers = ids.length ? await ChatRead.find({ thread: { $in: ids } }) : [];
    for (const r of markers) {
      if (controls(req.user, r.member)) reads[`${r.thread}|${r.member}`] = r.at;
    }

    return res.json({ success: true, chat: { threads: threads.map(threadOut), msgs, reads } });
  } catch (error) {
    console.error("Get chat error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/** The other adult must have an accepted invitation with this parent. */
const linkedCarer = async (user, otherEmail) => {
  const other = await User.findOne({ email: otherEmail, role: "parent" });
  if (!other) return null;
  const link = await CarerInvite.exists({
    state: "accepted",
    $or: [
      { owner: user._id, email: other.email },
      { owner: other._id, email: user.email },
    ],
  });
  return link ? other : null;
};

// POST /api/chat/threads
const openThread = async (req, res) => {
  try {
    const b = req.body || {};
    const kind = b.kind;
    const clientId = b.id || `th-${randomToken(10)}`;
    const key = text(b.key, 300);

    if (!["family", "shelf"].includes(kind)) {
      return res.status(400).json({ success: false, message: 'kind must be "family" or "shelf"' });
    }
    if (!isClientId(clientId)) return res.status(400).json({ success: false, message: "Invalid id" });

    // Same thread opened again (or from another device): return it.
    const existing = await ChatThread.findOne(key ? { $or: [{ clientId }, { key }] } : { clientId });
    if (existing) {
      if (canSee(existing, req.user)) return res.json({ success: true, item: threadOut(existing) });
      return res.status(409).json({ success: false, message: "That thread id is already in use" });
    }

    const members = Array.isArray(b.members) ? [...new Set(b.members.map(String))].slice(0, 20) : [];
    const me = adult(req.user.email);
    if (!members.includes(me)) return res.status(400).json({ success: false, message: "You must be a member of the thread" });

    let memberUsers = [req.user._id];
    if (kind === "family") {
      if (String(b.account || "").toLowerCase() !== String(req.user.email).toLowerCase()) {
        return res.status(403).json({ success: false, message: "Family chats belong to your own account" });
      }
      if (!members.every((m) => controls(req.user, m))) {
        return res.status(403).json({ success: false, message: "Family chats are between you and your children's profiles" });
      }
    } else {
      const others = members.filter((m) => m !== me);
      if (others.length !== 1 || !others[0].startsWith("mail:")) {
        return res.status(400).json({ success: false, message: "A shelf chat is between you and one carer" });
      }
      const carer = await linkedCarer(req.user, others[0].slice(5));
      if (!carer) {
        return res.status(403).json({ success: false, message: "You can only chat with someone who accepted a shelf invitation" });
      }
      memberUsers = [req.user._id, carer._id];
    }

    const thread = await ChatThread.create({
      clientId,
      key,
      kind,
      title: text(b.title, 120),
      account: kind === "family" ? String(req.user.email).toLowerCase() : String(b.account || "").toLowerCase().slice(0, 254),
      members,
      names: cleanNames(b.names, members),
      memberUsers,
      createdByUser: req.user._id,
      state: b.state === "closed" ? "closed" : "open",
      at: new Date(),
      startedAt: new Date(),
    });
    return res.status(201).json({ success: true, item: threadOut(thread) });
  } catch (error) {
    console.error("Open chat thread error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const findVisible = async (req, res) => {
  const thread = await ChatThread.findOne({ clientId: req.params.id });
  if (!thread || !canSee(thread, req.user)) {
    res.status(404).json({ success: false, message: "Thread not found" });
    return null;
  }
  return thread;
};

// POST /api/chat/threads/:id/messages
const sendMessage = async (req, res) => {
  try {
    const thread = await findVisible(req, res);
    if (!thread) return;
    const b = req.body || {};
    const clientId = b.id || `m-${randomToken(10)}`;
    const from = String(b.from || adult(req.user.email));
    const body = String(b.body == null ? "" : b.body).replace(/\s+$/, "").slice(0, 2000);

    if (!isClientId(clientId)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!body) return res.status(400).json({ success: false, message: "Write a message first" });
    if (thread.state === "closed") return res.status(409).json({ success: false, message: "This chat is closed" });
    if (!controls(req.user, from) || !thread.members.includes(from)) {
      return res.status(403).json({ success: false, message: "You can't send messages as that member" });
    }

    const existing = await ChatMessage.findOne({ clientId });
    if (existing) {
      if (String(existing.sender) === String(req.user._id)) return res.json({ success: true, item: messageOut(existing) });
      return res.status(409).json({ success: false, message: "That message id is already in use" });
    }

    const names = namesMap(thread);
    const message = await ChatMessage.create({
      clientId,
      thread: thread.clientId,
      from,
      name: text(b.name || names[from] || req.user.name, 120),
      body,
      sender: req.user._id,
      at: new Date(),
    });
    thread.at = message.at;
    await thread.save();

    return res.status(201).json({ success: true, item: messageOut(message) });
  } catch (error) {
    console.error("Send chat message error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// PUT /api/chat/threads/:id/read  { member, at }
const markRead = async (req, res) => {
  try {
    const thread = await findVisible(req, res);
    if (!thread) return;
    const member = String((req.body && req.body.member) || adult(req.user.email));
    const at = Math.min(Date.now(), Number(req.body && req.body.at) || Date.now());

    if (!controls(req.user, member) || !thread.members.includes(member)) {
      return res.status(403).json({ success: false, message: "You can't mark that member's messages as read" });
    }

    const existing = await ChatRead.findOne({ thread: thread.clientId, member });
    if (existing) {
      if (at > existing.at) {
        existing.at = at;
        await existing.save();
      }
    } else {
      await ChatRead.create({ thread: thread.clientId, member, at, user: req.user._id });
    }
    return res.json({ success: true, at: existing ? existing.at : at });
  } catch (error) {
    console.error("Mark chat read error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// PATCH /api/chat/threads/:id  { state }
const updateThread = async (req, res) => {
  try {
    const thread = await findVisible(req, res);
    if (!thread) return;
    const state = req.body && req.body.state;
    if (!["open", "closed"].includes(state)) {
      return res.status(400).json({ success: false, message: "State must be open or closed" });
    }
    thread.state = state;
    await thread.save();
    return res.json({ success: true, item: threadOut(thread) });
  } catch (error) {
    console.error("Update chat thread error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// DELETE /api/chat/threads/:id
const deleteThread = async (req, res) => {
  try {
    const thread = await findVisible(req, res);
    if (!thread) return;
    const owner = thread.kind === "family"
      ? thread.account === String(req.user.email).toLowerCase()
      : String(thread.createdByUser) === String(req.user._id);
    if (!owner) return res.status(403).json({ success: false, message: "Only the person who started this chat can delete it" });

    await ChatMessage.deleteMany({ thread: thread.clientId });
    await ChatRead.deleteMany({ thread: thread.clientId });
    await thread.deleteOne();
    return res.json({ success: true, message: "Chat deleted" });
  } catch (error) {
    console.error("Delete chat thread error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getChat, openThread, sendMessage, markRead, updateThread, deleteThread };
