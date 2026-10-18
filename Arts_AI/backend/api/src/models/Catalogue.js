const mongoose = require('mongoose');

const REVIEW_STATUSES = [
  'draft',
  'pending_review',
  'approved_for_learner',
  'rejected',
  'retired',
];

const CanonicalResourceSchema = new mongoose.Schema(
  {
    resourceId: { type: String, required: true, index: true },
    version: { type: String, required: true, default: '1' },
    curriculumVersion: { type: String, required: true, index: true },
    subjectId: { type: String, required: true, index: true },
    topicIds: { type: [String], default: [] },
    learningOutcomeIds: { type: [String], default: [] },
    language: { type: String, required: true },
    grade: { type: String },
    resourceType: { type: String, default: 'note' },
    title: { type: String },
    difficulty: { type: Number },
    difficultyBasis: { type: String },
    prerequisiteTopicIds: { type: [String], default: [] },
    sourceDocumentIdOrUrl: { type: String },
    availability: { type: String, default: 'internal' },
    permissionStatus: { type: String, required: true },
    usagePermissionOrLicense: { type: String },
    mappingBasis: { type: String, default: 'manual_canonical' },
    mappingStatus: {
      type: String,
      enum: ['exact_match', 'reviewed_equivalent', 'partial_match', 'unmapped', 'canonical_direct'],
      default: 'canonical_direct',
    },
    reviewStatus: { type: String, enum: REVIEW_STATUSES, default: 'draft', index: true },
    reviewerId: { type: String },
    reviewedAt: { type: Date },
    reviewEvidence: { type: String },
    contentHash: { type: String, required: true },
    provenance: { type: String },
    isTestFixture: { type: Boolean, default: false, index: true },
    dataOrigin: { type: String, default: 'canonical_import' },
    // Independent axes (do not collapse into reviewStatus)
    contentOrigin: {
      type: String,
      default: 'canonical_import',
      index: true,
    },
    automatedValidation: {
      type: String,
      enum: ['passed', 'failed', 'pending', 'not_run'],
      default: 'not_run',
      index: true,
    },
    humanReviewStatus: {
      type: String,
      enum: ['unreviewed', 'teacher_approved', 'teacher_rejected'],
      default: 'unreviewed',
      index: true,
    },
    learnerAvailability: {
      type: String,
      enum: ['draft', 'internal', 'published_practice', 'retired'],
      default: 'draft',
      index: true,
    },
    publishedAt: { type: Date },
    publishedBy: { type: String },
    publishedContentHash: { type: String },
    sourceIds: { type: [String], default: [] },
    supportingPassages: { type: mongoose.Schema.Types.Mixed },
    mappingConfidence: { type: String },
    bodyText: { type: String },
    retiredAt: { type: Date },
  },
  { timestamps: true }
);
CanonicalResourceSchema.index({ resourceId: 1, version: 1 }, { unique: true });

const CanonicalQuestionSchema = new mongoose.Schema(
  {
    questionId: { type: String, required: true, index: true },
    version: { type: String, required: true, default: '1' },
    curriculumVersion: { type: String, required: true, index: true },
    subjectId: { type: String, required: true, index: true },
    topicId: { type: String, required: true, index: true },
    learningOutcomeId: { type: String },
    language: { type: String, required: true },
    grade: { type: String },
    questionType: {
      type: String,
      enum: ['mcq', 'short_answer', 'structured', 'essay_rubric', 'true_false'],
      required: true,
    },
    prompt: { type: String, required: true },
    options: { type: mongoose.Schema.Types.Mixed },
    correctAnswerOrRubric: { type: String, required: true },
    explanation: { type: String },
    maxMarks: { type: Number, default: 1 },
    difficulty: { type: Number },
    difficultyBasis: { type: String },
    sourceReference: { type: String, required: true },
    provenance: { type: String, required: true },
    permissionStatus: { type: String, required: true },
    mappingBasis: { type: String, default: 'manual_canonical' },
    mappingStatus: {
      type: String,
      enum: ['exact_match', 'reviewed_equivalent', 'partial_match', 'unmapped', 'canonical_direct'],
      default: 'canonical_direct',
    },
    reviewStatus: { type: String, enum: REVIEW_STATUSES, default: 'draft', index: true },
    reviewerId: { type: String },
    reviewedAt: { type: Date },
    reviewEvidence: { type: String },
    contentHash: { type: String, required: true },
    isTestFixture: { type: Boolean, default: false, index: true },
    dataOrigin: { type: String, default: 'canonical_import' },
    contentOrigin: {
      type: String,
      default: 'canonical_import',
      index: true,
    },
    automatedValidation: {
      type: String,
      enum: ['passed', 'failed', 'pending', 'not_run'],
      default: 'not_run',
      index: true,
    },
    humanReviewStatus: {
      type: String,
      enum: ['unreviewed', 'teacher_approved', 'teacher_rejected'],
      default: 'unreviewed',
      index: true,
    },
    learnerAvailability: {
      type: String,
      enum: ['draft', 'internal', 'published_practice', 'retired'],
      default: 'draft',
      index: true,
    },
    publishedAt: { type: Date },
    publishedBy: { type: String },
    publishedContentHash: { type: String },
    sourceIds: { type: [String], default: [] },
    supportingPassages: { type: mongoose.Schema.Types.Mixed },
    mappingConfidence: { type: String },
    optionIds: { type: mongoose.Schema.Types.Mixed },
    retiredAt: { type: Date },
  },
  { timestamps: true }
);
CanonicalQuestionSchema.index({ questionId: 1, version: 1 }, { unique: true });

const QuizAssignmentSchema = new mongoose.Schema(
  {
    assignmentId: { type: String, required: true, unique: true },
    studentId: { type: String, required: true, index: true },
    curriculumVersion: { type: String, required: true },
    subjectId: { type: String, required: true },
    topicId: { type: String, required: true },
    language: { type: String, required: true },
    catalogueMode: { type: String, default: 'canonical' },
    status: {
      type: String,
      enum: ['assigned', 'submitting', 'submitted', 'cancelled'],
      default: 'assigned',
    },
    // Frozen snapshots at assign time (include answer keys server-side only)
    questions: [
      {
        questionId: String,
        version: String,
        questionType: String,
        prompt: String,
        options: mongoose.Schema.Types.Mixed,
        correctAnswerOrRubric: String,
        maxMarks: Number,
        contentHash: String,
        isTestFixture: { type: Boolean, default: false },
      },
    ],
    submittedAt: { type: Date },
    score: { type: Number },
    maxMarks: { type: Number },
    responses: [{ questionId: String, response: String, score: Number, maxMarks: Number }],
    isTestFixture: { type: Boolean, default: false },
    dataOrigin: { type: String, default: 'canonical_quiz' },
    submissionLockAt: { type: Date },
    // Durable recoverable submission
    pendingResponses: { type: mongoose.Schema.Types.Mixed },
    pendingFingerprint: { type: String },
    submissionLeaseUntil: { type: Date },
    submissionOwnerToken: { type: String },
    effectsApplied: {
      attempts: { type: Boolean, default: false },
      score: { type: Boolean, default: false },
      progress: { type: Boolean, default: false },
      twin: { type: Boolean, default: false },
      notification: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

module.exports = {
  REVIEW_STATUSES,
  CanonicalResource: mongoose.model('CanonicalResource', CanonicalResourceSchema),
  CanonicalQuestion: mongoose.model('CanonicalQuestion', CanonicalQuestionSchema),
  QuizAssignment: mongoose.model('QuizAssignment', QuizAssignmentSchema),
};
