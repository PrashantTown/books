const ChatThread = require("../models/ChatThread");
const ChatMessage = require("../models/ChatMessage");
const ChatRead = require("../models/ChatRead");
const Notification = require("../models/Notification");
const CarerInvite = require("../models/CarerInvite");
const SupportTicket = require("../models/SupportTicket");

/**
 * The frontend uses email addresses inside some ids (chat members such as
 * "mail:x@y.com" and "kid:x@y.com:c1", notification addresses such as
 * "parent::x@y.com"). When someone changes their sign-in email, rewrite those
 * so their chats, notifications and invitations follow them.
 */
const swapMember = (id, from, to) => {
  const value = String(id || "");
  if (value === `mail:${from}`) return `mail:${to}`;
  if (value.startsWith(`kid:${from}:`)) return `kid:${to}${value.slice(`kid:${from}`.length)}`;
  return value;
};

const renameAccountEmail = async (user, oldEmail, newEmail) => {
  const from = String(oldEmail || "").toLowerCase();
  const to = String(newEmail || "").toLowerCase();
  if (!from || !to || from === to) return;

  const threads = await ChatThread.find({
    $or: [{ account: from }, { memberUsers: user._id }],
  });

  for (const thread of threads) {
    if (thread.account === from) {
      thread.account = to;
      const bits = String(thread.key || "").split(":");
      if (bits.length >= 3 && bits[1] === from) {
        bits[1] = to;
        thread.key = bits.join(":");
      }
    }
    thread.members = thread.members.map((m) => swapMember(m, from, to));
    thread.names = (thread.names || []).map((entry) => ({ member: swapMember(entry.member, from, to), name: entry.name }));
    await thread.save();
  }

  const threadIds = threads.map((t) => t.clientId);
  const messages = await ChatMessage.find({ thread: { $in: threadIds } });
  for (const message of messages) {
    const next = swapMember(message.from, from, to);
    if (next !== message.from) {
      message.from = next;
      await message.save();
    }
  }

  const reads = await ChatRead.find({ thread: { $in: threadIds } });
  for (const read of reads) {
    const next = swapMember(read.member, from, to);
    if (next !== read.member) {
      read.member = next;
      await read.save();
    }
  }

  await Notification.updateMany({ to: `parent::${from}` }, { $set: { to: `parent::${to}` } });
  await Notification.updateMany({ to: `admin::${from}` }, { $set: { to: `admin::${to}` } });

  // Invitations sent to the old address now belong to the new one.
  await CarerInvite.updateMany({ email: from }, { $set: { email: to } });
  await CarerInvite.updateMany({ owner: user._id }, { $set: { by: to } });

  await SupportTicket.updateMany({ owner: user._id, fromEmail: from }, { $set: { fromEmail: to } });
  await SupportTicket.updateMany({ owner: user._id, replyTo: from }, { $set: { replyTo: to } });
};

module.exports = { renameAccountEmail, swapMember };
