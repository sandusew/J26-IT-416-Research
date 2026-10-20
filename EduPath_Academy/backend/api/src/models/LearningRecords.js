const mongoose = require('mongoose');

const DiagnosticAssignmentSchema = new mongoose.Schema(
  {
    assignmentId: { type: String, required: true, unique: true },
    studentId: { type: String, required: true, index: true },
    activityId: { type: String, required: true },
    topicId: { type: String },
    status: {
      type: String,
      enum: ['assigned', 'in_progress', 'completed', 'overdue', 'cancelled'],
      default: 'assigned',
    },
    assignedAt: { type: Date, default: Date.now },
    dueAt: { type: Date },
    completedAt: { type: Date },
    score: { type: Number },
    maxMarks: { type: Number, default: 1 },
    dataOrigin: { type: String, default: 'synthetic_operational' },
  },
  { timestamps: true }
);

const QuizAttemptSchema = new mongoose.Schema(
  {
    attemptId: { type: String, required: true, unique: true },
    studentId: { type: String, required: true, index: true },
    questionId: { type: String, required: true },
    topicId: { type: String },
    response: { type: String },
    score: { type: Number },
    maxMarks: { type: Number, default: 1 },
    gradingMethod: { type: String, default: 'auto' },
    submittedAt: { type: Date, default: Date.now },
    dataOrigin: { type: String, default: 'synthetic_learner' },
    isTestFixture: { type: Boolean, default: false, index: true },
    assignmentId: { type: String, index: true },
  },
  { timestamps: true }
);
// One attempt row per assignment question (idempotent concurrent submit)
QuizAttemptSchema.index({ assignmentId: 1, questionId: 1 }, { unique: true, sparse: true });

const ProgressSnapshotSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, index: true },
    topicId: { type: String },
    nAttempts: { type: Number, default: 0 },
    meanScore: { type: Number },
    lastAttemptAt: { type: Date },
    updatedAt: { type: Date, default: Date.now },
    // Authentic aggregates exclude isTestFixture attempts
    nAuthenticAttempts: { type: Number, default: 0 },
    authenticMeanScore: { type: Number },
    nFixtureAttempts: { type: Number, default: 0 },
    fixtureMeanScore: { type: Number },
    nUnknownProvenanceAttempts: { type: Number, default: 0 },
    includesTestFixtures: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const JoinRequestSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true, unique: true },
    groupId: { type: String, required: true, index: true },
    studentId: { type: String, required: true },
    status: {
      type: String,
      enum: ['requested', 'approved', 'declined', 'cancelled'],
      default: 'requested',
    },
  },
  { timestamps: true }
);
JoinRequestSchema.index(
  { groupId: 1, studentId: 1 },
  { unique: true, partialFilterExpression: { status: 'requested' } }
);

module.exports = {
  DiagnosticAssignment: mongoose.model('DiagnosticAssignment', DiagnosticAssignmentSchema),
  QuizAttempt: mongoose.model('QuizAttempt', QuizAttemptSchema),
  ProgressSnapshot: mongoose.model('ProgressSnapshot', ProgressSnapshotSchema),
  JoinRequest: mongoose.model('JoinRequest', JoinRequestSchema),
};
