const mongoose = require('mongoose');

const DigitalTwinProfileSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, index: true },
    profileVersion: { type: Number, required: true },
    payload: { type: Object, required: true },
    dataCategory: { type: String },
  },
  { timestamps: true }
);
DigitalTwinProfileSchema.index({ studentId: 1, profileVersion: 1 }, { unique: true });

const TwinHeadSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, unique: true },
    revision: { type: Number, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DigitalTwinProfile', DigitalTwinProfileSchema);
module.exports.TwinHead = mongoose.model('TwinHead', TwinHeadSchema);
