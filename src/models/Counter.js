const mongoose = require("mongoose");

/**
 * Named counters for sequential numbers, e.g. support ticket references.
 * `next("supportRef")` returns 1, 2, 3… safely across concurrent requests.
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

counterSchema.statics.next = async function next(name) {
  const doc = await this.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return doc.seq;
};

module.exports = mongoose.model("Counter", counterSchema);
