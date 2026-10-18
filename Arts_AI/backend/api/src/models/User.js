const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['student', 'teacher', 'admin'], required: true },
    displayName: { type: String, required: true },
    studentId: { type: String },
    teacherId: { type: String },
    isSyntheticFixture: { type: Boolean, default: true },
    dataOrigin: { type: String, default: 'synthetic_operational' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);
