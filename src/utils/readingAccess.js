const Child = require("../models/Child");
const ParentalControl = require("../models/ParentalControl");
const ReadingSession = require("../models/ReadingSession");

const isObjectId = (value) => /^[0-9a-fA-F]{24}$/.test(value || "");

const todayKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const minutesBetween = (start, end) =>
  Math.max(0, Math.floor((new Date(end) - new Date(start)) / 60000));

const childFilterForUser = (user, childId) => {
  if (user.role === "admin") return { _id: childId };
  if (user.role === "parent") return { _id: childId, parent: user._id };
  return { _id: childId, student: user._id };
};

const getChildForUser = (user, childId) =>
  Child.findOne(childFilterForUser(user, childId));

const getStudentChild = (user) =>
  Child.findOne({ student: user._id });

const getChildrenForParent = (user) =>
  Child.find({ parent: user._id });

const getControl = (childId) => ParentalControl.findOne({ childId });

const isWithinAllowedHours = (control, date = new Date()) => {
  const current = date.getHours() * 60 + date.getMinutes();
  const [startHour, startMinute] = control.allowedStartTime.split(":").map(Number);
  const [endHour, endMinute] = control.allowedEndTime.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;

  if (start === end) return true;
  if (start < end) return current >= start && current <= end;
  return current >= start || current <= end;
};

const getUsage = async (childId, date = todayKey()) => {
  const control = await getControl(childId);
  const sessions = await ReadingSession.find({
    childId,
    date,
    status: { $in: ["completed", "active", "blocked"] },
  });

  let total = 0;
  for (const session of sessions) {
    const duration = session.status === "active"
      ? minutesBetween(session.startTime, new Date())
      : session.duration;
    if (session.status === "active" && control && duration >= control.sessionLimit) {
      session.endTime = new Date();
      session.duration = control.sessionLimit;
      session.status = "blocked";
      await session.save();
    }
    total += Math.min(Math.max(0, duration || 0), control ? control.sessionLimit : Number.MAX_SAFE_INTEGER);
  }
  return total;
};

module.exports = {
  getChildForUser,
  getChildrenForParent,
  getControl,
  getStudentChild,
  getUsage,
  isObjectId,
  isWithinAllowedHours,
  minutesBetween,
  todayKey,
};