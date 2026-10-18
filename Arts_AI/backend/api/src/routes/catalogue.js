const express = require('express');
const { authRequired, requireRole } = require('../middleware/auth');
const { CanonicalQuestion, CanonicalResource } = require('../models/Catalogue');
const {
  importBatch,
  updateQuestion,
  CURRICULUM_VERSION,
  publishPracticeQuestion,
  publishPracticeResource,
  coverageCounts,
} = require('../services/catalogueService');
const { resolveFixtureAccess, applyFixtureFilter } = require('../services/fixturePolicy');
const { resolveContentPolicy, eligibleCatalogueFilter } = require('../services/contentPolicy');

const router = express.Router();

/** Staff-only import (dry-run or persist). Students forbidden. */
router.post(
  '/import',
  authRequired,
  requireRole('teacher', 'admin'),
  async (req, res) => {
    const persist =
      req.body.dryRun === false || req.query.dryRun === 'false' || req.body.persist === true;
    const atomic = req.body.atomic === true || req.query.atomic === 'true';
    const report = await importBatch({
      questions: req.body.questions || [],
      resources: req.body.resources || [],
      dryRun: !persist,
      atomic,
    });
    return res.status(persist ? 201 : 200).json(report);
  }
);

router.get(
  '/questions',
  authRequired,
  requireRole('teacher', 'admin'),
  async (req, res) => {
    const access = resolveFixtureAccess(req.query.includeFixtures);
    if (req.query.includeFixtures === 'true' && !access.allowed) {
      return res.status(403).json({
        error: 'fixtures_not_enabled',
        reason: access.reason,
        note: 'Set ARTS_AI_ALLOW_TEST_FIXTURES=true in non-production to list fixtures',
      });
    }
    let filter = {
      curriculumVersion: req.query.curriculumVersion || CURRICULUM_VERSION,
    };
    if (req.query.topicId) filter.topicId = req.query.topicId;
    if (req.query.subjectId) filter.subjectId = req.query.subjectId;
    if (req.query.reviewStatus) filter.reviewStatus = req.query.reviewStatus;
    filter = applyFixtureFilter(filter, access);
    const rows = await CanonicalQuestion.find(filter).sort({ topicId: 1, questionId: 1 }).lean();
    const out = rows.map((q) => {
      if (req.query.includeKeys === 'true') return q;
      const { correctAnswerOrRubric, ...rest } = q;
      return { ...rest, answerKeyPresent: !!correctAnswerOrRubric };
    });
    return res.json({
      n: out.length,
      questions: out,
      fixturesIncluded: access.allowed,
    });
  }
);

router.get('/resources', authRequired, async (req, res) => {
  const access = resolveFixtureAccess(req.query.includeFixtures);
  let filter = {
    curriculumVersion: req.query.curriculumVersion || CURRICULUM_VERSION,
  };
  if (req.query.subjectId) filter.subjectId = req.query.subjectId;
  if (req.query.topicId) filter.topicIds = req.query.topicId;
  if (req.user.role === 'student') {
    const { filter: elig } = eligibleCatalogueFilter(
      filter,
      req.query.contentPolicy,
      { allowed: false }
    );
    filter = elig;
  } else {
    if (req.query.reviewStatus) filter.reviewStatus = req.query.reviewStatus;
    if (req.query.includeFixtures === 'true' && !access.allowed) {
      return res.status(403).json({
        error: 'fixtures_not_enabled',
        reason: access.reason,
      });
    }
    filter = applyFixtureFilter(filter, access);
  }
  const rows = await CanonicalResource.find(filter).lean();
  return res.json({ n: rows.length, resources: rows, fixturesIncluded: access.allowed && req.user.role !== 'student' });
});

/** Approve / reject — staff only; reviewer from JWT only. */
router.post(
  '/questions/:questionId/versions/:version/review',
  authRequired,
  requireRole('teacher', 'admin'),
  async (req, res) => {
    const { decision, reviewEvidence } = req.body || {};
    if (!['approved_for_learner', 'rejected', 'pending_review', 'retired'].includes(decision)) {
      return res.status(400).json({ error: 'invalid_decision' });
    }
    if (decision === 'approved_for_learner' && !reviewEvidence) {
      return res.status(400).json({ error: 'review_evidence_required' });
    }
    // Ignore any client-supplied reviewerId
    const doc = await CanonicalQuestion.findOne({
      questionId: req.params.questionId,
      version: req.params.version,
    });
    if (!doc) return res.status(404).json({ error: 'not_found' });
    if (doc.mappingStatus === 'partial_match') {
      return res.status(409).json({
        error: 'partial_match_cannot_be_approved_as_verified',
        note: 'Canonical IDs alone do not prove review',
      });
    }
    doc.reviewStatus = decision;
    doc.reviewerId = req.user.teacherId || req.user.sub || req.user.username;
    doc.reviewedAt = new Date();
    doc.reviewEvidence = reviewEvidence || null;
    if (decision === 'approved_for_learner' && !doc.isTestFixture) {
      doc.humanReviewStatus = 'teacher_approved';
    } else if (decision === 'rejected') {
      doc.humanReviewStatus = 'teacher_rejected';
    }
    if (decision === 'retired') doc.retiredAt = new Date();
    await doc.save();
    return res.json({
      questionId: doc.questionId,
      version: doc.version,
      contentHash: doc.contentHash,
      reviewStatus: doc.reviewStatus,
      humanReviewStatus: doc.humanReviewStatus,
      reviewerId: doc.reviewerId,
      reviewedAt: doc.reviewedAt,
      isTestFixture: doc.isTestFixture,
      note: doc.isTestFixture
        ? 'TEST FIXTURE approval — not counted as authentic teacher review'
        : 'Review recorded for exact content version',
    });
  }
);

/** Publish practice content — does NOT forge teacher approval. */
router.post(
  '/questions/:questionId/versions/:version/publish-practice',
  authRequired,
  requireRole('teacher', 'admin'),
  async (req, res) => {
    const actor = req.user.teacherId || req.user.sub || req.user.username;
    const out = await publishPracticeQuestion(
      req.params.questionId,
      req.params.version,
      actor,
      req.body.contentHash || req.body.expectedHash
    );
    if (!out.ok) return res.status(out.error === 'not_found' ? 404 : 409).json(out);
    return res.json(out);
  }
);

router.post(
  '/resources/:resourceId/versions/:version/publish-practice',
  authRequired,
  requireRole('teacher', 'admin'),
  async (req, res) => {
    const actor = req.user.teacherId || req.user.sub || req.user.username;
    const out = await publishPracticeResource(
      req.params.resourceId,
      req.params.version,
      actor,
      req.body.contentHash || req.body.expectedHash
    );
    if (!out.ok) return res.status(out.error === 'not_found' ? 404 : 409).json(out);
    return res.json(out);
  }
);

/** Bulk publish all draft items that already passed automated validation (local/admin). */
router.post(
  '/publish-practice/eligible',
  authRequired,
  requireRole('teacher', 'admin'),
  async (req, res) => {
    const actor = req.user.teacherId || req.user.sub || req.user.username;
    const { CanonicalQuestion, CanonicalResource } = require('../models/Catalogue');
    const qFilter = {
      isTestFixture: { $ne: true },
      automatedValidation: 'passed',
      learnerAvailability: { $ne: 'published_practice' },
      reviewStatus: { $nin: ['rejected', 'retired'] },
    };
    if (req.body.topicId) qFilter.topicId = req.body.topicId;
    if (req.body.subjectId) qFilter.subjectId = req.body.subjectId;
    const questions = await CanonicalQuestion.find(qFilter).lean();
    const resources = await CanonicalResource.find({
      isTestFixture: { $ne: true },
      automatedValidation: 'passed',
      learnerAvailability: { $ne: 'published_practice' },
      reviewStatus: { $nin: ['rejected', 'retired'] },
      ...(req.body.subjectId ? { subjectId: req.body.subjectId } : {}),
      ...(req.body.topicId ? { topicIds: req.body.topicId } : {}),
    }).lean();
    const published = [];
    const failed = [];
    for (const q of questions) {
      const out = await publishPracticeQuestion(q.questionId, q.version, actor, q.contentHash);
      if (out.ok) published.push({ kind: 'question', ...out });
      else failed.push({ kind: 'question', questionId: q.questionId, ...out });
    }
    for (const r of resources) {
      const out = await publishPracticeResource(r.resourceId, r.version, actor, r.contentHash);
      if (out.ok) published.push({ kind: 'resource', ...out });
      else failed.push({ kind: 'resource', resourceId: r.resourceId, ...out });
    }
    const counts = await coverageCounts();
    return res.json({
      nPublished: published.length,
      nFailed: failed.length,
      published,
      failed,
      coverage: counts,
      contentPolicy: resolveContentPolicy(req.body.contentPolicy),
      note: 'Bulk practice publication — not teacher approval',
    });
  }
);

router.patch(
  '/questions/:questionId/versions/:version',
  authRequired,
  requireRole('teacher', 'admin'),
  async (req, res) => {
    const actor = req.user.teacherId || req.user.sub || req.user.username;
    // Never accept client reviewStatus/reviewerId via patch body as approval
    const patch = { ...(req.body || {}) };
    delete patch.reviewerId;
    delete patch.reviewedAt;
    delete patch.reviewEvidence;
    if (patch.reviewStatus === 'approved_for_learner') {
      return res.status(400).json({
        error: 'use_review_endpoint_for_approval',
        note: 'PATCH cannot approve; POST .../review required',
      });
    }
    const out = await updateQuestion(req.params.questionId, req.params.version, patch, actor);
    if (!out.ok) return res.status(out.error === 'not_found' ? 404 : 400).json(out);
    return res.json(out);
  }
);

router.post(
  '/resources/:resourceId/versions/:version/review',
  authRequired,
  requireRole('teacher', 'admin'),
  async (req, res) => {
    const { decision, reviewEvidence } = req.body || {};
    if (!['approved_for_learner', 'rejected', 'pending_review', 'retired'].includes(decision)) {
      return res.status(400).json({ error: 'invalid_decision' });
    }
    if (decision === 'approved_for_learner' && !reviewEvidence) {
      return res.status(400).json({ error: 'review_evidence_required' });
    }
    const doc = await CanonicalResource.findOne({
      resourceId: req.params.resourceId,
      version: req.params.version,
    });
    if (!doc) return res.status(404).json({ error: 'not_found' });
    if (doc.mappingStatus === 'partial_match') {
      return res.status(409).json({ error: 'partial_match_cannot_be_approved_as_verified' });
    }
    doc.reviewStatus = decision;
    doc.reviewerId = req.user.teacherId || req.user.sub || req.user.username;
    doc.reviewedAt = new Date();
    doc.reviewEvidence = reviewEvidence;
    if (decision === 'retired') doc.retiredAt = new Date();
    await doc.save();
    return res.json({
      resourceId: doc.resourceId,
      version: doc.version,
      contentHash: doc.contentHash,
      reviewStatus: doc.reviewStatus,
      reviewerId: doc.reviewerId,
      isTestFixture: doc.isTestFixture,
    });
  }
);

router.get('/meta', authRequired, async (_req, res) => {
  const [
    nQ,
    nR,
    nApprovedQ,
    nFixtureApprovedQ,
    nApprovedR,
    nFixtureApprovedR,
    coverage,
  ] = await Promise.all([
    CanonicalQuestion.countDocuments({}),
    CanonicalResource.countDocuments({}),
    CanonicalQuestion.countDocuments({
      reviewStatus: 'approved_for_learner',
      isTestFixture: { $ne: true },
    }),
    CanonicalQuestion.countDocuments({
      reviewStatus: 'approved_for_learner',
      isTestFixture: true,
    }),
    CanonicalResource.countDocuments({
      reviewStatus: 'approved_for_learner',
      isTestFixture: { $ne: true },
    }),
    CanonicalResource.countDocuments({
      reviewStatus: 'approved_for_learner',
      isTestFixture: true,
    }),
    coverageCounts(),
  ]);
  return res.json({
    curriculumVersion: CURRICULUM_VERSION,
    nQuestions: nQ,
    nResources: nR,
    nApprovedNonFixtureQuestions: nApprovedQ,
    nApprovedFixtureQuestions: nFixtureApprovedQ,
    nApprovedNonFixtureResources: nApprovedR,
    nApprovedFixtureResources: nFixtureApprovedR,
    coverage,
    defaultContentPolicy: resolveContentPolicy(),
    note: 'Fixtures never increase authentic approved / teacher-review counts; practice publication is separate',
  });
});

module.exports = router;
