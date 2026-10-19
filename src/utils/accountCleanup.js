const User = require("../models/User");
const Child = require("../models/Child");
const ParentalControl = require("../models/ParentalControl");
const ReadingSession = require("../models/ReadingSession");
const Wishlist = require("../models/Wishlist");
const Review = require("../models/Review");
const ShelfBook = require("../models/ShelfBook");
const ReadingLog = require("../models/ReadingLog");
const FamilyProfile = require("../models/FamilyProfile");
const UserData = require("../models/UserData");
const BoardPost = require("../models/BoardPost");
const BookReview = require("../models/BookReview");
const Suggestion = require("../models/Suggestion");
const SupportTicket = require("../models/SupportTicket");
const SupportScreenshot = require("../models/SupportScreenshot");
const Notification = require("../models/Notification");
const CarerInvite = require("../models/CarerInvite");
const ChatThread = require("../models/ChatThread");
const ChatMessage = require("../models/ChatMessage");
const ChatRead = require("../models/ChatRead");
const ShareLink = require("../models/ShareLink");

/**
 * Deletes a person's account and everything that belongs to it: their
 * children and the student logins created for them, the family shelf,
 * settings, posts, reviews, suggestions, support reports, notifications,
 * carer invitations, chats and share links.
 *
 * The activity log is kept on purpose so administrators keep a record.
 */
const deleteAccountAndData = async (user) => {
  const userId = user._id;
  const email = String(user.email || "").toLowerCase();

  const children = await Child.find({ parent: userId }).select("_id student");
  const childIds = children.map((c) => c._id);
  const studentIds = children.map((c) => c.student).filter(Boolean);

  const tickets = await SupportTicket.find({ owner: userId }).select("_id");
  const threads = await ChatThread.find({
    $or: [{ createdByUser: userId }, { account: email }],
  }).select("clientId");
  const threadIds = threads.map((t) => t.clientId);

  await Promise.all([
    ParentalControl.deleteMany({ $or: [{ childId: { $in: childIds } }, { parentId: userId }] }),
    ReadingSession.deleteMany({ childId: { $in: childIds } }),
    Wishlist.deleteMany({ studentId: { $in: [...studentIds, userId] } }),
    Review.deleteMany({ studentId: { $in: [...studentIds, userId] } }),
    User.deleteMany({ _id: { $in: studentIds }, role: "student" }),
    Child.deleteMany({ parent: userId }),

    ShelfBook.deleteMany({ owner: userId }),
    ReadingLog.deleteMany({ owner: userId }),
    FamilyProfile.deleteMany({ user: userId }),
    UserData.deleteMany({ user: userId }),

    BoardPost.deleteMany({ owner: userId }),
    BookReview.deleteMany({ owner: userId }),
    Suggestion.deleteMany({ owner: userId }),
    SupportScreenshot.deleteMany({ ticket: { $in: tickets.map((t) => t._id) } }),
    SupportTicket.deleteMany({ owner: userId }),

    Notification.deleteMany({ to: { $in: [`parent::${email}`, `admin::${email}`] } }),
    Notification.updateMany({}, { $pull: { readBy: userId, dismissedBy: userId } }),

    CarerInvite.deleteMany({ $or: [{ owner: userId }, { email }] }),

    ChatMessage.deleteMany({ $or: [{ thread: { $in: threadIds } }, { sender: userId }] }),
    ChatRead.deleteMany({ $or: [{ thread: { $in: threadIds } }, { user: userId }] }),
    ChatThread.deleteMany({ clientId: { $in: threadIds } }),
    ChatThread.updateMany({ memberUsers: userId }, { $pull: { memberUsers: userId }, $set: { state: "closed" } }),

    ShareLink.deleteMany({ owner: userId }),
  ]);

  await User.deleteOne({ _id: userId });
};

module.exports = { deleteAccountAndData };
