/**
 * Learner content eligibility — independent of teacher approval and fixtures.
 *
 * contentPolicy:
 *   published_practice (default local) — AI-authored or authentic public items with
 *     automated_validation=passed, learnerAvailability=published_practice, not fixtures.
 *   teacher_reviewed_only — reviewStatus=approved_for_learner only (strict deployments).
 *
 * Publication never sets reviewStatus=approved_for_learner and never increases
 * authentic/teacher-reviewed coverage counters.
 */
const config = require('../config');

const CONTENT_ORIGINS = new Set([
  'authentic_public',
  'ai_authored_source_grounded',
  'teacher_authored',
  'machine_authored_test_fixture',
  'canonical_import',
]);

function resolveContentPolicy(requested) {
  const raw = String(
    requested || config.contentPolicy || process.env.ARTS_AI_CONTENT_POLICY || 'published_practice'
  )
    .trim()
    .toLowerCase();
  if (raw === 'teacher_reviewed_only' || raw === 'reviewed_only' || raw === 'strict') {
    return {
      policy: 'teacher_reviewed_only',
      note: 'Only reviewStatus=approved_for_learner; excludes unreviewed practice and fixtures',
    };
  }
  return {
    policy: 'published_practice',
    note:
      'Published practice (AI-authored or public) with automated validation; not teacher-reviewed unless separately approved',
  };
}

/**
 * Build Mongo filter for eligible questions/resources under a content policy.
 * Always excludes fixtures unless fixtureAccess.allowed (and caller opts in separately).
 */
function eligibleCatalogueFilter(base, contentPolicy, fixtureAccess = { allowed: false }) {
  const resolved = resolveContentPolicy(contentPolicy);
  const filter = { ...base, retiredAt: null };

  if (resolved.policy === 'teacher_reviewed_only') {
    filter.reviewStatus = 'approved_for_learner';
    filter.isTestFixture = { $ne: true };
    return { filter, resolved, learnerLabel: 'teacher_reviewed' };
  }

  // published_practice: never require forged teacher approval
  filter.isTestFixture = { $ne: true };
  filter.learnerAvailability = 'published_practice';
  filter.automatedValidation = 'passed';
  filter.contentOrigin = {
    $in: ['ai_authored_source_grounded', 'authentic_public', 'teacher_authored'],
  };
  // Exclude retired review statuses; draft/pending OK if published_practice set via publish endpoint
  filter.reviewStatus = { $nin: ['rejected', 'retired'] };
  if (!fixtureAccess.allowed) {
    filter.isTestFixture = { $ne: true };
  }
  return {
    filter,
    resolved,
    learnerLabel: 'ai_authored_or_public_practice_not_teacher_reviewed',
  };
}

function learnerFacingProvenance(doc) {
  const origin = doc.contentOrigin || doc.provenance || 'unknown';
  const human = doc.humanReviewStatus || 'unreviewed';
  const labels = [];
  if (origin === 'ai_authored_source_grounded') {
    labels.push('AI-authored practice content (source-grounded)');
  } else if (origin === 'authentic_public') {
    labels.push('Authentic public supplemental content');
  } else if (origin === 'teacher_authored') {
    labels.push('Teacher-authored');
  }
  if (human === 'unreviewed' || doc.reviewStatus !== 'approved_for_learner') {
    labels.push('Not teacher-reviewed');
  } else {
    labels.push('Teacher-reviewed');
  }
  if (doc.isTestFixture) labels.push('TEST FIXTURE');
  return {
    contentOrigin: origin,
    humanReviewStatus: human,
    reviewStatus: doc.reviewStatus,
    learnerAvailability: doc.learnerAvailability || null,
    automatedValidation: doc.automatedValidation || null,
    labels,
  };
}

module.exports = {
  CONTENT_ORIGINS,
  resolveContentPolicy,
  eligibleCatalogueFilter,
  learnerFacingProvenance,
};
