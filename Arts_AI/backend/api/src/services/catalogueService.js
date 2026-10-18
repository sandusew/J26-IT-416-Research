const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  CanonicalQuestion,
  CanonicalResource,
  REVIEW_STATUSES,
} = require('../models/Catalogue');

const CURRICULUM_VERSION = 'nie_al_arts_provisional_v0.1';
const SUBJECTS = new Set([
  'sub_history',
  'sub_geography',
  'sub_political',
  'sub_economics',
  'sub_sinhala_lit',
]);
const SUPPORTED_LANG = new Set(['en', 'english', 'si', 'sinhala', 'ta', 'tamil']);
const QTYPES = new Set(['mcq', 'short_answer', 'structured', 'essay_rubric', 'true_false']);

function registryPath() {
  return path.join(
    __dirname,
    '..',
    '..',
    '..',
    'ml',
    'data',
    'curriculum',
    `${CURRICULUM_VERSION}_registry.json`
  );
}

function loadCanonicalTopicMap() {
  const p = registryPath();
  if (!fs.existsSync(p)) return new Map();
  const reg = JSON.parse(fs.readFileSync(p, 'utf8'));
  const map = new Map();
  for (const t of reg.topics || []) {
    map.set(t.topic_id, t);
  }
  return map;
}

function shaContent(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function questionContentFingerprint(row) {
  return shaContent({
    curriculumVersion: row.curriculumVersion,
    subjectId: row.subjectId,
    topicId: row.topicId,
    language: row.language,
    questionType: row.questionType,
    prompt: row.prompt,
    options: row.options || null,
    correctAnswerOrRubric: row.correctAnswerOrRubric,
    maxMarks: row.maxMarks,
    explanation: row.explanation || null,
  });
}

function resourceContentFingerprint(row) {
  return shaContent({
    curriculumVersion: row.curriculumVersion,
    subjectId: row.subjectId,
    topicIds: row.topicIds || [],
    language: row.language,
    resourceType: row.resourceType,
    title: row.title || null,
    difficulty: row.difficulty,
    sourceDocumentIdOrUrl: row.sourceDocumentIdOrUrl,
    bodyText: row.bodyText || null,
  });
}

function parseOptions(raw) {
  if (raw == null || raw === '') return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return raw;
  const s = String(raw).trim();
  try {
    return JSON.parse(s);
  } catch {
    // pipe or semicolon separated A|B|C|D
    if (s.includes('|')) return s.split('|').map((x) => x.trim());
    return s;
  }
}

function validateQuestionRow(row, topics, { forImport = false } = {}) {
  const errs = [];
  const qid = row.questionId || row.question_id;
  const cv = row.curriculumVersion || row.curriculum_version || CURRICULUM_VERSION;
  const subjectId = row.subjectId || row.subject_id;
  const topicId = row.topicId || row.topic_id;
  const lang = String(row.language || '').toLowerCase();
  const qtype = String(row.questionType || row.question_type || '').toLowerCase();
  const prompt = row.prompt || row.text;
  const answer = row.correctAnswerOrRubric || row.correct_answer_or_rubric || row.answer_or_rubric;
  const provenance = row.provenance || row.data_origin;
  const source = row.sourceReference || row.source_reference;
  const permission = row.permissionStatus || row.permission_status;
  const version = String(row.version || '1');
  const mappingStatus = row.mappingStatus || row.mapping_status || 'canonical_direct';

  if (!qid) errs.push('missing_question_id');
  if (cv !== CURRICULUM_VERSION) errs.push(`invalid_curriculum_version:${cv}`);
  if (!SUBJECTS.has(subjectId)) errs.push(`unknown_subject_id:${subjectId}`);
  if (!topicId || !topics.has(topicId)) errs.push(`unknown_topic_id:${topicId}`);
  else if (topics.get(topicId).subject_id !== subjectId) {
    errs.push(`topic_subject_mismatch:${topicId}`);
  }
  if (!SUPPORTED_LANG.has(lang)) errs.push(`unsupported_language:${lang}`);
  if (!QTYPES.has(qtype)) errs.push(`unsupported_question_type:${qtype}`);
  if (!prompt) errs.push('missing_prompt');
  if (!answer) errs.push('missing_answer_key');
  if (!provenance) errs.push('missing_provenance');
  if (!source) errs.push('missing_source_reference');
  if (!permission) errs.push('missing_permission_status');
  if (mappingStatus === 'partial_match') {
    errs.push('partial_match_not_accepted_as_verified_canonical');
  }
  const options = parseOptions(row.options);
  if (qtype === 'mcq') {
    if (!options || (Array.isArray(options) && options.length < 2)) {
      errs.push('mcq_missing_options');
    }
  }
  let reviewStatus = row.reviewStatus || row.review_status || 'draft';
  if (!REVIEW_STATUSES.includes(reviewStatus)) errs.push(`invalid_review_status:${reviewStatus}`);
  if (forImport && reviewStatus === 'approved_for_learner') {
    errs.push('import_cannot_set_approved_for_learner_use_review_endpoint');
  }
  if (forImport && String(provenance).includes('authentic_past_paper')) {
    errs.push('past_paper_claim_requires_review_endpoint_not_import');
  }

  const normalized = {
    questionId: qid,
    version,
    curriculumVersion: cv,
    subjectId,
    topicId,
    learningOutcomeId: row.learningOutcomeId || row.learning_outcome_id || null,
    language: lang === 'english' ? 'en' : lang === 'sinhala' ? 'si' : lang === 'tamil' ? 'ta' : lang,
    grade: row.grade || topics.get(topicId)?.grade || null,
    questionType: qtype,
    prompt: String(prompt),
    options,
    correctAnswerOrRubric: String(answer),
    explanation: row.explanation || null,
    maxMarks: Number(row.maxMarks || row.max_marks || 1),
    difficulty: row.difficulty != null ? Number(row.difficulty) : null,
    difficultyBasis: row.difficultyBasis || row.difficulty_basis || 'unspecified',
    sourceReference: String(source),
    provenance: String(provenance),
    permissionStatus: String(permission),
    mappingBasis: row.mappingBasis || row.mapping_basis || 'manual_canonical',
    mappingStatus,
    reviewStatus:
      forImport && reviewStatus === 'approved_for_learner' ? 'draft' : reviewStatus,
    reviewerId: forImport ? null : row.reviewerId || row.reviewer_id || null,
    reviewedAt: forImport ? null : row.reviewedAt || row.reviewed_at || null,
    reviewEvidence: forImport ? null : row.reviewEvidence || row.review_evidence || null,
    isTestFixture: !!(row.isTestFixture || row.is_test_fixture),
    dataOrigin: row.dataOrigin || row.data_origin || 'canonical_import',
    contentOrigin:
      row.contentOrigin ||
      row.content_origin ||
      (row.isTestFixture || row.is_test_fixture
        ? 'machine_authored_test_fixture'
        : row.dataOrigin || row.data_origin || 'canonical_import'),
    automatedValidation: row.automatedValidation || row.automated_validation || 'not_run',
    humanReviewStatus: row.humanReviewStatus || row.human_review_status || 'unreviewed',
    // Import never publishes and never forges teacher approval
    learnerAvailability:
      forImport
        ? 'draft'
        : row.learnerAvailability || row.learner_availability || 'draft',
    sourceIds: row.sourceIds || row.source_ids || [],
    supportingPassages: row.supportingPassages || row.supporting_passages || null,
    mappingConfidence: row.mappingConfidence || row.mapping_confidence || null,
    optionIds: row.optionIds || row.option_ids || null,
  };
  if (forImport) {
    normalized.humanReviewStatus = 'unreviewed';
    normalized.publishedAt = null;
    normalized.publishedBy = null;
    normalized.publishedContentHash = null;
  }
  if (!['passed', 'failed', 'pending', 'not_run'].includes(normalized.automatedValidation)) {
    errs.push(`invalid_automated_validation:${normalized.automatedValidation}`);
  }
  normalized.contentHash = questionContentFingerprint(normalized);
  return { errs, normalized };
}

function validateResourceRow(row, topics, { forImport = false } = {}) {
  const errs = [];
  const rid = row.resourceId || row.resource_id;
  const cv = row.curriculumVersion || row.curriculum_version || CURRICULUM_VERSION;
  const subjectId = row.subjectId || row.subject_id;
  let topicIds = row.topicIds || row.topic_ids || row.topic_id;
  if (typeof topicIds === 'string') {
    topicIds = topicIds.split(/[|,]/).map((t) => t.trim()).filter(Boolean);
  }
  if (!Array.isArray(topicIds)) topicIds = topicIds ? [topicIds] : [];
  const lang = String(row.language || '').toLowerCase();
  const permission = row.permissionStatus || row.permission_status;
  const version = String(row.version || '1');
  const mappingStatus = row.mappingStatus || row.mapping_status || 'canonical_direct';

  if (!rid) errs.push('missing_resource_id');
  if (cv !== CURRICULUM_VERSION) errs.push(`invalid_curriculum_version:${cv}`);
  if (!SUBJECTS.has(subjectId)) errs.push(`unknown_subject_id:${subjectId}`);
  if (!topicIds.length) errs.push('missing_topic_ids');
  for (const tid of topicIds) {
    if (!topics.has(tid)) errs.push(`unknown_topic_id:${tid}`);
    else if (topics.get(tid).subject_id !== subjectId) errs.push(`topic_subject_mismatch:${tid}`);
  }
  if (!SUPPORTED_LANG.has(lang)) errs.push(`unsupported_language:${lang}`);
  if (!permission) errs.push('missing_permission_status');
  if (mappingStatus === 'partial_match') {
    errs.push('partial_match_not_accepted_as_verified_canonical');
  }
  const source = row.sourceDocumentIdOrUrl || row.source_document_id_or_url || row.source_url;
  if (!source) errs.push('missing_source');

  let reviewStatus = row.reviewStatus || row.review_status || 'draft';
  if (forImport && reviewStatus === 'approved_for_learner') {
    errs.push('import_cannot_set_approved_for_learner_use_review_endpoint');
  }
  const normalized = {
    resourceId: rid,
    version,
    curriculumVersion: cv,
    subjectId,
    topicIds,
    learningOutcomeIds: row.learningOutcomeIds || [],
    language: lang === 'english' ? 'en' : lang,
    grade: row.grade || null,
    resourceType: row.resourceType || row.resource_type || 'note',
    title: row.title || null,
    difficulty: row.difficulty != null ? Number(row.difficulty) : null,
    difficultyBasis: row.difficultyBasis || row.difficulty_basis || 'unspecified',
    prerequisiteTopicIds: row.prerequisiteTopicIds || row.prerequisite_topic_ids || [],
    sourceDocumentIdOrUrl: String(source),
    availability: row.availability || 'internal',
    permissionStatus: String(permission),
    usagePermissionOrLicense: row.usagePermissionOrLicense || row.usage_permission_or_license || permission,
    mappingBasis: row.mappingBasis || 'manual_canonical',
    mappingStatus,
    reviewStatus:
      forImport && reviewStatus === 'approved_for_learner' ? 'draft' : reviewStatus,
    reviewerId: forImport ? null : row.reviewerId || null,
    reviewedAt: forImport ? null : row.reviewedAt || null,
    reviewEvidence: forImport ? null : row.reviewEvidence || row.review_evidence || null,
    provenance: row.provenance || 'canonical_import',
    isTestFixture: !!(row.isTestFixture || row.is_test_fixture),
    dataOrigin: row.dataOrigin || 'canonical_import',
    contentOrigin:
      row.contentOrigin ||
      row.content_origin ||
      (row.isTestFixture || row.is_test_fixture
        ? 'machine_authored_test_fixture'
        : row.dataOrigin || 'canonical_import'),
    automatedValidation: row.automatedValidation || row.automated_validation || 'not_run',
    humanReviewStatus: row.humanReviewStatus || row.human_review_status || 'unreviewed',
    learnerAvailability: forImport
      ? 'draft'
      : row.learnerAvailability || row.learner_availability || row.availability || 'draft',
    sourceIds: row.sourceIds || row.source_ids || [],
    supportingPassages: row.supportingPassages || null,
    mappingConfidence: row.mappingConfidence || null,
    bodyText: row.bodyText || row.body_text || null,
  };
  if (forImport) {
    normalized.humanReviewStatus = 'unreviewed';
    normalized.publishedAt = null;
    normalized.publishedBy = null;
    normalized.publishedContentHash = null;
  }
  normalized.contentHash = resourceContentFingerprint(normalized);
  return { errs, normalized };
}

async function upsertQuestion(normalized, { dryRun }) {
  const existing = await CanonicalQuestion.findOne({
    questionId: normalized.questionId,
    version: normalized.version,
  });
  if (existing) {
    if (existing.contentHash === normalized.contentHash) {
      return { status: 'idempotent_unchanged', questionId: normalized.questionId, version: normalized.version };
    }
    return {
      status: 'conflict_version_hash_mismatch',
      questionId: normalized.questionId,
      version: normalized.version,
      existingHash: existing.contentHash,
      incomingHash: normalized.contentHash,
    };
  }
  // New version of same id: if prior approved and content differs, leave prior intact
  if (dryRun) {
    return { status: 'would_accept', questionId: normalized.questionId, version: normalized.version };
  }
  await CanonicalQuestion.create(normalized);
  return { status: 'accepted', questionId: normalized.questionId, version: normalized.version };
}

async function upsertResource(normalized, { dryRun }) {
  const existing = await CanonicalResource.findOne({
    resourceId: normalized.resourceId,
    version: normalized.version,
  });
  if (existing) {
    if (existing.contentHash === normalized.contentHash) {
      return { status: 'idempotent_unchanged', resourceId: normalized.resourceId, version: normalized.version };
    }
    return {
      status: 'conflict_version_hash_mismatch',
      resourceId: normalized.resourceId,
      version: normalized.version,
    };
  }
  if (dryRun) {
    return { status: 'would_accept', resourceId: normalized.resourceId, version: normalized.version };
  }
  await CanonicalResource.create(normalized);
  return { status: 'accepted', resourceId: normalized.resourceId, version: normalized.version };
}

async function importBatch({ questions = [], resources = [], dryRun = true, atomic = false }) {
  const topics = loadCanonicalTopicMap();
  const accepted = [];
  const rejected = [];
  // Validate all rows first (batch validation before any persist when atomic)
  const qNorms = [];
  const rNorms = [];
  for (const row of questions) {
    const { errs, normalized } = validateQuestionRow(row, topics, { forImport: true });
    if (errs.length) {
      rejected.push({ kind: 'question', id: row.questionId || row.question_id, errors: errs });
    } else {
      qNorms.push(normalized);
    }
  }
  for (const row of resources) {
    const { errs, normalized } = validateResourceRow(row, topics, { forImport: true });
    if (errs.length) {
      rejected.push({ kind: 'resource', id: row.resourceId || row.resource_id, errors: errs });
    } else {
      rNorms.push(normalized);
    }
  }
  if (atomic && rejected.length && !dryRun) {
    return {
      dryRun,
      atomic: true,
      curriculumVersion: CURRICULUM_VERSION,
      nAccepted: 0,
      nRejected: rejected.length,
      accepted: [],
      rejected,
      note: 'atomic_import_aborted_validation_errors — no rows persisted',
    };
  }
  for (const normalized of qNorms) {
    const result = await upsertQuestion(normalized, { dryRun });
    if (String(result.status).startsWith('conflict')) rejected.push({ kind: 'question', ...result });
    else accepted.push({ kind: 'question', ...result });
  }
  for (const normalized of rNorms) {
    const result = await upsertResource(normalized, { dryRun });
    if (String(result.status).startsWith('conflict')) rejected.push({ kind: 'resource', ...result });
    else accepted.push({ kind: 'resource', ...result });
  }
  return {
    dryRun,
    atomic: !!atomic,
    curriculumVersion: CURRICULUM_VERSION,
    nAccepted: accepted.length,
    nRejected: rejected.length,
    accepted,
    rejected,
    importContract: atomic
      ? 'all_or_nothing_on_validation_errors'
      : 'partial_import_valid_rows_persisted_invalid_rejected',
    note:
      'partial_match rejected; import cannot approve; review endpoint sets reviewer identity',
  };
}

/**
 * Editing scoring-critical fields of an approved question forces re-review.
 */
async function updateQuestion(questionId, version, patch, actorId) {
  const doc = await CanonicalQuestion.findOne({ questionId, version });
  if (!doc) return { ok: false, error: 'not_found' };
  const next = {
    ...doc.toObject(),
    ...patch,
    questionId,
    version,
  };
  const { errs, normalized } = validateQuestionRow(next, loadCanonicalTopicMap(), {
    forImport: false,
  });
  if (errs.length) return { ok: false, error: 'validation_failed', errors: errs };
  // Preserve existing review fields unless scoring content changes
  normalized.reviewerId = doc.reviewerId;
  normalized.reviewedAt = doc.reviewedAt;
  normalized.reviewEvidence = doc.reviewEvidence;
  normalized.reviewStatus = doc.reviewStatus;
  const scoringChanged = normalized.contentHash !== doc.contentHash;
  if (doc.reviewStatus === 'approved_for_learner' && scoringChanged) {
    normalized.reviewStatus = 'pending_review';
    normalized.reviewerId = null;
    normalized.reviewedAt = null;
    normalized.reviewEvidence = `reopened_after_edit_by_${actorId}`;
  }
  // Material edits invalidate practice publication until re-validated and re-published
  if (scoringChanged && doc.learnerAvailability === 'published_practice') {
    normalized.learnerAvailability = 'draft';
    normalized.publishedAt = null;
    normalized.publishedBy = null;
    normalized.publishedContentHash = null;
    normalized.automatedValidation = 'pending';
  }
  // Preserve publication/review axes unless scoring changed
  if (!scoringChanged) {
    normalized.learnerAvailability = doc.learnerAvailability;
    normalized.publishedAt = doc.publishedAt;
    normalized.publishedBy = doc.publishedBy;
    normalized.publishedContentHash = doc.publishedContentHash;
    normalized.automatedValidation = doc.automatedValidation;
    normalized.humanReviewStatus = doc.humanReviewStatus;
    normalized.contentOrigin = doc.contentOrigin;
  }
  Object.assign(doc, normalized);
  await doc.save();
  return {
    ok: true,
    question: doc,
    reReviewRequired: scoringChanged && doc.reviewStatus === 'pending_review',
    publicationInvalidated: scoringChanged && normalized.learnerAvailability === 'draft',
  };
}

/**
 * Publish practice content for learners without forging teacher approval.
 * Requires: not fixture, automatedValidation=passed, exact contentHash match.
 */
async function publishPracticeItem(Model, idField, id, version, actorId, expectedHash) {
  const doc = await Model.findOne({ [idField]: id, version: String(version) });
  if (!doc) return { ok: false, error: 'not_found' };
  if (doc.isTestFixture) {
    return { ok: false, error: 'fixtures_cannot_be_published_as_practice' };
  }
  if (doc.automatedValidation !== 'passed') {
    return {
      ok: false,
      error: 'automated_validation_required',
      automatedValidation: doc.automatedValidation,
    };
  }
  if (expectedHash && expectedHash !== doc.contentHash) {
    return {
      ok: false,
      error: 'content_hash_mismatch',
      note: 'Publication must reference the exact validated version/hash',
      expectedHash,
      actualHash: doc.contentHash,
    };
  }
  if (['rejected', 'retired'].includes(doc.reviewStatus)) {
    return { ok: false, error: 'rejected_or_retired_cannot_publish' };
  }
  doc.learnerAvailability = 'published_practice';
  doc.publishedAt = new Date();
  doc.publishedBy = actorId;
  doc.publishedContentHash = doc.contentHash;
  // Explicitly do NOT set reviewStatus=approved_for_learner or humanReviewStatus=teacher_approved
  if (doc.humanReviewStatus !== 'teacher_approved') {
    doc.humanReviewStatus = 'unreviewed';
  }
  await doc.save();
  return {
    ok: true,
    [idField]: doc[idField],
    version: doc.version,
    contentHash: doc.contentHash,
    learnerAvailability: doc.learnerAvailability,
    reviewStatus: doc.reviewStatus,
    humanReviewStatus: doc.humanReviewStatus,
    contentOrigin: doc.contentOrigin,
    note: 'Published as practice — does not count as teacher review or authentic approval',
  };
}

async function publishPracticeQuestion(questionId, version, actorId, expectedHash) {
  return publishPracticeItem(
    CanonicalQuestion,
    'questionId',
    questionId,
    version,
    actorId,
    expectedHash
  );
}

async function publishPracticeResource(resourceId, version, actorId, expectedHash) {
  return publishPracticeItem(
    CanonicalResource,
    'resourceId',
    resourceId,
    version,
    actorId,
    expectedHash
  );
}

async function coverageCounts() {
  const base = { isTestFixture: { $ne: true } };
  const [
    authenticApprovedQ,
    authenticApprovedR,
    publishedPracticeQ,
    publishedPracticeR,
    draftQ,
    draftR,
    fixtureQ,
    fixtureR,
    teacherReviewedQ,
    teacherReviewedR,
    aiAuthoredPublishedQ,
  ] = await Promise.all([
    CanonicalQuestion.countDocuments({
      ...base,
      reviewStatus: 'approved_for_learner',
      contentOrigin: { $in: ['authentic_public', 'teacher_authored'] },
    }),
    CanonicalResource.countDocuments({
      ...base,
      reviewStatus: 'approved_for_learner',
      contentOrigin: { $in: ['authentic_public', 'teacher_authored'] },
    }),
    CanonicalQuestion.countDocuments({
      ...base,
      learnerAvailability: 'published_practice',
    }),
    CanonicalResource.countDocuments({
      ...base,
      learnerAvailability: 'published_practice',
    }),
    CanonicalQuestion.countDocuments({ ...base, learnerAvailability: 'draft' }),
    CanonicalResource.countDocuments({ ...base, learnerAvailability: 'draft' }),
    CanonicalQuestion.countDocuments({ isTestFixture: true }),
    CanonicalResource.countDocuments({ isTestFixture: true }),
    CanonicalQuestion.countDocuments({
      ...base,
      $or: [
        { reviewStatus: 'approved_for_learner', humanReviewStatus: 'teacher_approved' },
        { humanReviewStatus: 'teacher_approved' },
      ],
    }),
    CanonicalResource.countDocuments({
      ...base,
      $or: [
        { reviewStatus: 'approved_for_learner', humanReviewStatus: 'teacher_approved' },
        { humanReviewStatus: 'teacher_approved' },
      ],
    }),
    CanonicalQuestion.countDocuments({
      ...base,
      learnerAvailability: 'published_practice',
      contentOrigin: 'ai_authored_source_grounded',
    }),
  ]);
  return {
    authenticApprovedQuestions: authenticApprovedQ,
    authenticApprovedResources: authenticApprovedR,
    publishedPracticeQuestions: publishedPracticeQ,
    publishedPracticeResources: publishedPracticeR,
    unpublishedDraftQuestions: draftQ,
    unpublishedDraftResources: draftR,
    testFixtureQuestions: fixtureQ,
    testFixtureResources: fixtureR,
    teacherReviewedQuestions: teacherReviewedQ,
    teacherReviewedResources: teacherReviewedR,
    aiAuthoredPublishedQuestions: aiAuthoredPublishedQ,
    note: 'Publication does not increase authenticApproved* or teacherReviewed* counts',
  };
}

module.exports = {
  CURRICULUM_VERSION,
  importBatch,
  updateQuestion,
  validateQuestionRow,
  validateResourceRow,
  loadCanonicalTopicMap,
  questionContentFingerprint,
  publishPracticeQuestion,
  publishPracticeResource,
  coverageCounts,
};
