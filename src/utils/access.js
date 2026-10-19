/**
 * Small helpers shared by the community controllers.
 */

const isAdmin = (user) => Boolean(user && user.role === "admin");

const sameUser = (a, b) => Boolean(a && b && String(a._id || a) === String(b._id || b));

/** The frontend's notification address for a user, e.g. "parent::x@y.com". */
const addressFor = (user) => `${user.role === "admin" ? "admin" : "parent"}::${String(user.email).toLowerCase()}`;

/** Addresses whose notifications this user should see. */
const addressesFor = (user) => {
  const side = user.role === "admin" ? "admin" : "parent";
  return [`${side}::${String(user.email).toLowerCase()}`, `${side}::*`];
};

/** Owner email for a document whose `owner` field may be populated. */
const ownerEmail = (doc) => (doc && doc.owner && doc.owner.email ? doc.owner.email : "");

/**
 * Applies an administrator's moderation decision to a post/review/suggestion.
 * `removedState` is the state that carries a reason ("removed" or "rejected").
 */
const applyDecision = (doc, state, reason, admin, removedState) => {
  doc.state = state;
  doc.reason = state === removedState ? String(reason || "").trim().slice(0, 600) : "";
  doc.decidedBy = state === "pending" ? "" : admin.email;
  doc.decidedAt = state === "pending" ? null : new Date();
};

module.exports = { isAdmin, sameUser, addressFor, addressesFor, ownerEmail, applyDecision };
