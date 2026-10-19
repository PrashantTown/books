const mongoose = require("mongoose");

const childSchema = new mongoose.Schema(
  {
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    // The /api/children endpoints still require an age. Children created from
    // the family shelf may leave it blank, so the schema allows null.
    age: {
      type: Number,
      default: null,
      min: 0,
      max: 18,
    },

    band: {
      type: String,
      required: true,
      trim: true,
    },

    colour: {
      type: String,
      default: "#0D3B32",
    },

    likes: {
      type: [String],
      default: [],
    },

    // The id the frontend gave this child (for example "c1"). Books and
    // reading-log entries on the family shelf refer to children by this id.
    clientId: {
      type: String,
      default: null,
      trim: true,
    },

    // Order on the family shelf.
    position: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

childSchema.index(
  { parent: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: "string" } } }
);

module.exports = mongoose.model("Child", childSchema);