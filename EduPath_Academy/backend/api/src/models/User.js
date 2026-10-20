const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['student', 'teacher', 'admin'], required: true },
    displayName: { type: String, required: true },
    studentId: { type: String },
    teacherId: { type: String },
    email: { type: String },
    school: { type: String },
    grade: { type: String },
    subjectIds: { type: [String], default: undefined },
    onboardingStatus: {
      type: String,
      enum: ['not_required', 'not_started', 'in_progress', 'completed'],
      default: 'not_required',
    },
    onboardingAssignmentId: { type: String },
    onboardingCompletedAt: { type: Date },
    isSyntheticFixture: { type: Boolean, default: true },
    dataOrigin: { type: String, default: 'synthetic_operational' },
  },
  { timestamps: true }
);

UserSchema.index(
  { studentId: 1 },
  { unique: true, partialFilterExpression: { studentId: { $type: 'string' } } }
);
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);

module.exports = mongoose.model('User', UserSchema);
