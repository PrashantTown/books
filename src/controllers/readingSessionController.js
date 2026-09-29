const Book = require("../models/Book");
const ReadingSession = require("../models/ReadingSession");
const {
  getChildForUser,
  getChildrenForParent,
  getControl,
  getUsage,
  isObjectId,
  isWithinAllowedHours,
  minutesBetween,
  getStudentChild,
  todayKey,
} = require("../utils/readingAccess");

const usageData = async (childId, control) => {
  const usedMinutes = await getUsage(childId);
  return {
    dailyLimit: control ? control.dailyLimit : 0,
    usedMinutes,
    remainingMinutes: control ? Math.max(0, control.dailyLimit - usedMinutes) : 0,
  };
};

const findStudentChild = async (req, res, childId) => {
  const child = await getChildForUser(req.user, childId);
  if (!child) {
    res.status(req.user.role === "admin" ? 404 : 403).json({
      success: false,
      message: "You do not have access to this child",
    });
    return null;
  }
  return child;
};

const startSession = async (req, res) => {
  try {
    if (req.user.role !== "student") {
      return res.status(403).json({ success: false, message: "Student permission required" });
    }

    const { bookId } = req.body || {};
    if (!isObjectId(bookId)) {
      return res.status(400).json({ success: false, message: "A valid bookId is required" });
    }

    const book = await Book.findById(bookId);
    if (!book) return res.status(404).json({ success: false, message: "Book not found" });
    if (book.status !== "active") return res.status(403).json({ success: false, message: "Book is not active" });

    const child = await getStudentChild(req.user);
    if (!child) {
      return res.status(404).json({ success: false, message: "Student is not linked to a child" });
    }

    const control = await getControl(child._id);
    if (!control) return res.status(403).json({ success: false, message: "Parental controls are not configured" });
    if (!control.isEnabled) return res.status(403).json({ success: false, message: "Reading is disabled by parental controls" });
    if (!isWithinAllowedHours(control)) return res.status(403).json({ success: false, message: "Reading is not allowed at this time" });

    const usage = await usageData(child._id, control);
    if (usage.remainingMinutes <= 0) return res.status(403).json({ success: false, message: "Daily reading limit reached" });

    const activeSession = await ReadingSession.findOne({ childId: child._id, status: "active" });
    if (activeSession) return res.status(409).json({ success: false, message: "An active reading session already exists", session: activeSession });

    const session = await ReadingSession.create({
      childId: child._id,
      bookId: book._id,
      startTime: new Date(),
      date: todayKey(),
      status: "active",
    });

    res.status(201).json({ success: true, message: "Reading session started", session, remainingTime: usage.remainingMinutes });
  } catch (error) {
    console.error("Start reading session error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const endSession = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid session ID" });
    const session = await ReadingSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: "Reading session not found" });
    const child = await getChildForUser(req.user, session.childId);
    if (!child) return res.status(403).json({ success: false, message: "You do not have access to this reading session" });
    if (session.status !== "active") return res.status(409).json({ success: false, message: "Reading session has already ended" });

    const control = await getControl(child._id);
    const endTime = new Date();
    const elapsed = minutesBetween(session.startTime, endTime);
    session.endTime = endTime;
    session.duration = control ? Math.min(elapsed, control.sessionLimit) : elapsed;
    session.status = control && elapsed >= control.sessionLimit ? "blocked" : "completed";
    await session.save();

    res.json({ success: true, message: "Reading session ended", session });
  } catch (error) {
    console.error("End reading session error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getTodayUsage = async (req, res) => {
  try {
    let child;
    if (req.user.role === "student") child = await getStudentChild(req.user);
    else if (req.params.childId) child = await findStudentChild(req, res, req.params.childId);
    else return res.status(400).json({ success: false, message: "childId is required for this account" });
    if (!child) return;
    const control = await getControl(child._id);
    res.json({ success: true, data: await usageData(child._id, control) });
  } catch (error) {
    console.error("Get reading usage error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getRemainingTime = async (req, res) => {
  try {
    if (!isObjectId(req.params.childId)) return res.status(400).json({ success: false, message: "Invalid child ID" });
    const child = await findStudentChild(req, res, req.params.childId);
    if (!child) return;
    const control = await getControl(child._id);
    const usage = await usageData(child._id, control);
    const activeSession = await ReadingSession.findOne({ childId: child._id, status: "active" });
    res.json({
      success: true,
      data: {
        ...usage,
        activeSessionMinutes: activeSession ? minutesBetween(activeSession.startTime, new Date()) : 0,
      },
    });
  } catch (error) {
    console.error("Get remaining reading time error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getHistory = async (req, res) => {
  try {
    let childFilter = {};
    if (req.user.role === "student") {
      const child = await getStudentChild(req.user);
      if (!child) return res.status(404).json({ success: false, message: "Student is not linked to a child" });
      childFilter = { childId: child._id };
    } else if (req.user.role === "parent") {
      const children = await getChildrenForParent(req.user);
      childFilter = { childId: { $in: children.map((child) => child._id) } };
    }
    if (req.query.date) childFilter.date = req.query.date;
    const sessions = await ReadingSession.find(childFilter)
      .sort({ startTime: -1 })
      .populate("bookId", "title author")
      .populate("childId", "name parent student");
    res.json({ success: true, data: sessions });
  } catch (error) {
    console.error("Get reading history error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  startSession,
  endSession,
  getTodayUsage,
  getHistory,
  getRemainingTime,
};