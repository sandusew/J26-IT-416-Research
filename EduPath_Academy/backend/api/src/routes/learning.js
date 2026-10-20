const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { authRequired, requireOwnership, requireRole } = require('../middleware/auth');
const { mlFetch } = require('../services/mlClient');
const DigitalTwinProfile = require('../models/DigitalTwinProfile');
const { PeerGroup, GroupMembership, Notification } = require('../models/PeerGroup');
const {
  DiagnosticAssignment,
  QuizAttempt,
  ProgressSnapshot,
  JoinRequest,
} = require('../models/LearningRecords');
const { CanonicalQuestion, CanonicalResource, QuizAssignment } = require('../models/Catalogue');
const { CURRICULUM_VERSION } = require('../services/catalogueService');
const { resolveFixtureAccess, applyFixtureFilter } = require('../services/fixturePolicy');
const {
  eligibleCatalogueFilter,
  learnerFacingProvenance,
  resolveContentPolicy,
} = require('../services/contentPolicy');
const {
  submitCanonicalAssignment,
  recoverStuckSubmissions,
  rebuildProgress,
  syncObservedTwinFromAttempts,
} = require('../services/quizSubmission');

const router = express.Router();

function syntheticRoot() {
  return path.join(__dirname, '..', '..', '..', 'ml', 'data', 'synthetic');
}

function latestSyntheticDir() {
  const root = syntheticRoot();
  if (!fs.existsSync(root)) return null;
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(root, d.name))
    .filter((d) => fs.existsSync(path.join(d, 'dataset_manifest.json')));
  // Prefer full baseline over tiny unit fixtures when both exist
  const preferred = dirs.find((d) => path.basename(d).startsWith('arts_al_baseline'));
  if (preferred) return preferred;
  dirs.sort();
  return dirs.length ? dirs[dirs.length - 1] : null;
}

/** RFC4180-ish CSV parse (handles quoted fields with commas). */
function parseCsvLine(line) {
  const cols = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

const _csvCache = new Map();

function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const st = fs.statSync(file);
  const hit = _csvCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.rows;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i];
    });
    return obj;
  });
  _csvCache.set(file, { mtimeMs: st.mtimeMs, rows });
  return rows;
}

function finiteMarks(raw, fallback = 1) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function claimMembershipSlot(group) {
  const max = group.maxMembers || 20;
  if (group.memberCount == null) {
    const n = await GroupMembership.countDocuments({ groupId: group.groupId });
    await PeerGroup.updateOne(
      { groupId: group.groupId, memberCount: { $exists: false } },
      { $set: { memberCount: n } }
    );
  }
  return PeerGroup.findOneAndUpdate(
    { groupId: group.groupId, memberCount: { $lt: max } },
    { $inc: { memberCount: 1 } },
    { new: true }
  );
}

async function releaseMembershipSlot(groupId) {
  await PeerGroup.updateOne({ groupId, memberCount: { $gt: 0 } }, { $inc: { memberCount: -1 } });
}

async function notify(userId, type, payload) {
  await Notification.create({
    notificationId: `ntf_${uuidv4().slice(0, 10)}`,
    userId: String(userId),
    type,
    payload,
  });
}

function latestRankerMeta() {
  const art = path.join(__dirname, '..', '..', '..', 'ml', 'artifacts', 'c2');
  const pointer = path.join(art, 'LATEST_RANK_RUN.txt');
  if (!fs.existsSync(pointer)) {
    return { modelVersion: null, artifactPresent: false, compatibility: 'unavailable' };
  }
  const runId = fs.readFileSync(pointer, 'utf8').trim();
  const modelPath = path.join(art, runId, 'ranker_pointwise.joblib');
  // Saved ranker was trained on synthetic difficulty + stu_open_rate — feature-compatible
  // with historical synthetic catalogue scoring only. Canonical NIE topic IDs are incompatible.
  return {
    modelVersion: runId,
    artifactPresent: fs.existsSync(modelPath),
    compatibility: 'features_ok_historical_synthetic_topic_vocabulary_only',
    note: 'Do not treat ranker scores as curriculum-aligned effectiveness',
  };
}

function isSyntheticTopicId(topicId) {
  return /^sub_[a-z0-9_]+_t\d{2}$/i.test(String(topicId || ''));
}

function isCanonicalTopicId(topicId) {
  const t = String(topicId || '');
  if (!t || isSyntheticTopicId(t)) return false;
  return /^(hist_|geo_|pol_|eco_|si_)/i.test(t);
}

/**
 * Ranker may score only historical synthetic catalogue topic IDs.
 * Canonical / mixed catalogues must fall back — do not remap categorical topics.
 */
function rankerCatalogueCompatibility(eligible, catalogueMode, curriculumVersion) {
  const mode = String(catalogueMode || 'synthetic_historical').toLowerCase();
  // curriculumVersion alone does not force fallback if eligible topics remain synthetic
  if (mode === 'canonical' || mode === 'curriculum') {
    return {
      ok: false,
      reason: 'topic_vocabulary_incompatible_canonical_catalogue',
      compatibility: 'incompatible_canonical_curriculum',
      curriculumVersion: curriculumVersion || null,
    };
  }
  const topics = eligible.map((e) => e.topicId);
  const hasCanonical = topics.some(isCanonicalTopicId);
  const hasSynthetic = topics.some(isSyntheticTopicId);
  if (hasCanonical && !hasSynthetic) {
    return {
      ok: false,
      reason: 'topic_vocabulary_incompatible_canonical_topic_ids',
      compatibility: 'incompatible_canonical_topic_ids',
    };
  }
  if (hasCanonical && hasSynthetic) {
    return {
      ok: false,
      reason: 'topic_vocabulary_mixed_canonical_and_synthetic',
      compatibility: 'incompatible_mixed_topic_vocabulary',
    };
  }
  if (topics.length && topics.every(isSyntheticTopicId)) {
    return {
      ok: true,
      reason: null,
      compatibility: 'historical_synthetic_catalogue_compatible',
    };
  }
  if (!topics.length) {
    return {
      ok: true,
      reason: null,
      compatibility: 'empty_eligible_set',
    };
  }
  return {
    ok: false,
    reason: 'topic_vocabulary_unknown_or_unmapped',
    compatibility: 'incompatible_unknown_topic_vocabulary',
  };
}

function buildEligibleCandidates(dir, studentId, subjectId, practised) {
  const topics = readCsv(path.join(dir, 'topics.csv'));
  const resources = readCsv(path.join(dir, 'resources.csv'));
  const prereqs = readCsv(path.join(dir, 'topic_prerequisites.csv'));
  const sid = subjectId || (topics[0] && topics[0].subject_id);
  const eligible = [];
  for (const topic of topics.filter((t) => t.subject_id === sid)) {
    const pre = prereqs
      .filter((p) => p.topic_id === topic.topic_id)
      .map((p) => p.prerequisite_topic_id);
    const prereqOk = pre.every((p) => practised.has(p));
    const already = practised.has(topic.topic_id);
    // Eligibility: must satisfy prerequisites (same constraint for both policies)
    if (!prereqOk) continue;
    let base = already ? 0.3 : 1.0;
    if (already) base *= 0.2;
    for (const r of resources.filter((x) => x.topic_id === topic.topic_id)) {
      const difficulty = Number(r.difficulty || 0.5);
      eligible.push({
        resourceId: r.resource_id,
        topicId: topic.topic_id,
        difficulty: Number.isFinite(difficulty) ? difficulty : 0.5,
        prereqOk: true,
        alreadyPractised: already,
        prerequisiteScore: base * (1 - (Number.isFinite(difficulty) ? difficulty : 0.5) * 0.2),
        reasonPrereq: already
          ? 'prerequisites_met_but_topic_already_practised'
          : 'next_topic_prerequisites_met',
      });
    }
  }
  return { subjectId: sid, eligible };
}

// --- Digital Twin (Mongo persistence; optional ML enrichment) ---
router.post(
  '/digital-twin/:studentId/update',
  authRequired,
  requireOwnership('studentId'),
  async (req, res) => {
    const studentId = req.params.studentId;
    const events = req.body.events || [];
    const enrolledSubjects = req.body.enrolledSubjects || req.body.enrolled_subjects || [];
    const curriculumVersion =
      req.body.curriculumVersion || req.body.curriculum_version || 'nie_al_arts_provisional_v0.1';
    // Client-supplied performance is untrusted — never overrides server-derived authentic aggregates
    const clientTopicPerformance = req.body.topicPerformance || req.body.topic_performance || {};
    const attempts = await QuizAttempt.find({ studentId });
    const byTopic = {};
    for (const a of attempts) {
      const tid = a.topicId || '_none';
      if (!byTopic[tid]) byTopic[tid] = [];
      byTopic[tid].push(a);
    }
    const authenticPerf = {};
    const fixturePerf = {};
    for (const [tid, rows] of Object.entries(byTopic)) {
      if (tid === '_none') continue;
      await rebuildProgress(studentId, tid);
      const auth = rows.filter((r) => r.isTestFixture === false);
      const fix = rows.filter((r) => r.isTestFixture === true);
      if (auth.length) {
        authenticPerf[tid] = {
          meanScore: auth.reduce((s, r) => s + (r.score || 0), 0) / auth.length,
          nAttempts: auth.length,
          provenance: 'server_quiz_attempts_authentic',
        };
      }
      if (fix.length) {
        fixturePerf[tid] = {
          meanScore: fix.reduce((s, r) => s + (r.score || 0), 0) / fix.length,
          nAttempts: fix.length,
          provenance: 'server_quiz_attempts_fixture',
        };
      }
    }
    const dataCategory =
      Object.keys(fixturePerf).length && !Object.keys(authenticPerf).length
        ? 'test_fixture_learner'
        : req.body.data_category === 'test_fixture_learner'
          ? 'test_fixture_learner'
          : req.body.data_category || 'synthetic_learner';
    let payload = {
      student_id: studentId,
      evidence_count: Object.values(authenticPerf).reduce((s, t) => s + (t.nAttempts || 0), 0),
      evidence_count_fixture: Object.values(fixturePerf).reduce((s, t) => s + (t.nAttempts || 0), 0),
      state: Object.keys(authenticPerf).length ? 'ok' : 'insufficient_authentic_data',
      observation_window_days: req.body.observation_window_days || 14,
      data_category: dataCategory,
      curriculum_version: curriculumVersion,
      enrolled_subjects: enrolledSubjects,
      canonical_topic_ids_seen: Object.keys(authenticPerf),
      // Trusted authentic aggregates only
      observed_topic_performance: authenticPerf,
      observed_topic_performance_fixture: fixturePerf,
      client_supplied_topic_performance: clientTopicPerformance,
      client_supplied_note:
        'Client topic_performance stored separately and does not override server authentic aggregates',
      estimated_mastery: null,
      estimated_mastery_method: 'not_computed_insufficient_local_labels',
      resource_interaction_count: events.filter((e) => e.type === 'resource' || e.event_type === 'resource')
        .length,
      evidence_timestamps: events
        .map((e) => e.timestamp || e.ts)
        .filter(Boolean)
        .slice(-20),
      cluster_id: null,
      model_version: null,
      weak_topics: Object.entries(authenticPerf)
        .filter(([, v]) => (v.meanScore ?? 1) < 0.5)
        .map(([k]) => k),
      distinctions: {
        observed_performance: 'authentic quiz attempts only (isTestFixture=false)',
        fixture_performance: 'separate; never mixed into authentic Twin fields',
        estimated_mastery: 'not claimed as trained cognitive model without labelled Arts data',
        behaviour_cluster: 'OULAD experimental transfer only when features compatible',
      },
      transfer_warning:
        'OULAD-derived clusters are not assumed valid for Arts learners without evaluation',
    };
    try {
      const ml = await mlFetch('/v1/digital-twin/update', {
        method: 'POST',
        body: JSON.stringify({
          student_id: studentId,
          events,
          observation_window_days: payload.observation_window_days,
          data_category: payload.data_category,
        }),
      });
      // Preserve server authentic aggregates over any ML overwrite of those keys
      const authKeep = payload.observed_topic_performance;
      const fixKeep = payload.observed_topic_performance_fixture;
      payload = { ...payload, ...ml };
      payload.observed_topic_performance = authKeep;
      payload.observed_topic_performance_fixture = fixKeep;
    } catch {
      payload.ml_enrichment = 'unavailable';
    }
    const doc = await syncObservedTwinFromAttempts(studentId, {
      observation_window_days: payload.observation_window_days,
      curriculum_version: payload.curriculum_version,
      enrolled_subjects: payload.enrolled_subjects,
      client_supplied_topic_performance: payload.client_supplied_topic_performance,
      client_supplied_note: payload.client_supplied_note,
      resource_interaction_count: payload.resource_interaction_count,
      evidence_timestamps: payload.evidence_timestamps,
      distinctions: payload.distinctions,
      transfer_warning: payload.transfer_warning,
      ml_enrichment: payload.ml_enrichment,
      model_version: payload.model_version,
      source: 'digital_twin_update',
    });
    await notify(studentId, 'digital_twin_updated', { profileVersion: doc.profileVersion });
    return res.status(201).json({ profile: doc, payload: doc.payload });
  }
);

router.get('/digital-twin/:studentId', authRequired, requireOwnership('studentId'), async (req, res) => {
  const latest = await DigitalTwinProfile.findOne({ studentId: req.params.studentId }).sort({
    profileVersion: -1,
  });
  return res.json({ profile: latest, persistent: true });
});

// --- Progress (Mongo attempts + optional synthetic summary) ---
router.get('/progress/:studentId', authRequired, requireOwnership('studentId'), async (req, res) => {
  const snaps = await ProgressSnapshot.find({ studentId: req.params.studentId });
  const attempts = await QuizAttempt.find({ studentId: req.params.studentId });
  const authenticAttempts = attempts.filter((a) => !a.isTestFixture);
  const fixtureAttempts = attempts.filter((a) => a.isTestFixture);
  const practiceAttempts = authenticAttempts.filter((a) => a.topicId !== 'onboarding_general');
  const nCompletedPracticeQuizzes = await QuizAssignment.countDocuments({
    studentId: req.params.studentId,
    status: 'submitted',
    purpose: { $ne: 'onboarding' },
  });
  const diagnostics = await DiagnosticAssignment.find({ studentId: req.params.studentId });
  const { practiceAccuracy, subjectForTopic } = require('../services/quizHistory');
  const bySubject = {};
  for (const snap of snaps) {
    const subjectId = subjectForTopic(snap.topicId);
    if (!subjectId) continue;
    if (!bySubject[subjectId]) bySubject[subjectId] = { subjectId, topics: 0, attempts: 0, scoreSum: 0, weight: 0 };
    const n = Number(snap.nAuthenticAttempts ?? snap.nAttempts) || 0;
    const mean = Number(snap.authenticMeanScore ?? snap.meanScore);
    bySubject[subjectId].topics += 1;
    bySubject[subjectId].attempts += n;
    if (Number.isFinite(mean) && n > 0) {
      bySubject[subjectId].scoreSum += mean * n;
      bySubject[subjectId].weight += n;
    }
  }
  return res.json({
    studentId: req.params.studentId,
    progressSnapshots: snaps,
    nQuizAttempts: attempts.length,
    nAuthenticQuizAttempts: authenticAttempts.length,
    nPracticeQuestionAttempts: practiceAttempts.length,
    nCompletedPracticeQuizzes,
    nFixtureQuizAttempts: fixtureAttempts.length,
    nDiagnosticsCompleted: diagnostics.filter((d) => d.status === 'completed').length,
    practiceAccuracy: practiceAccuracy(practiceAttempts),
    subjectPerformance: Object.values(bySubject).map((row) => ({
      subjectId: row.subjectId,
      topicsWithSnapshots: row.topics,
      attempts: row.attempts,
      meanScore: row.weight ? row.scoreSum / row.weight : null,
    })),
    causalClaim: false,
    note: 'Fixture attempts excluded from authentic aggregates; practice accuracy is not syllabus completion',
  });
});

// --- Diagnostics: assign + complete ---
router.post(
  '/diagnostics/:studentId/assign',
  authRequired,
  requireRole('teacher', 'admin', 'student'),
  requireOwnership('studentId'),
  async (req, res) => {
    const { activityId, topicId, dueAt, maxMarks } = req.body || {};
    if (!activityId) return res.status(400).json({ error: 'activityId_required' });
    const assignmentId = `diag_${uuidv4().slice(0, 10)}`;
    const doc = await DiagnosticAssignment.create({
      assignmentId,
      studentId: req.params.studentId,
      activityId,
      topicId,
      dueAt: dueAt ? new Date(dueAt) : undefined,
      maxMarks: finiteMarks(maxMarks, 1) || 1,
      status: 'assigned',
    });
    await notify(req.params.studentId, 'diagnostic_assigned', { assignmentId });
    return res.status(201).json({ assignment: doc });
  }
);

router.post(
  '/diagnostics/:studentId/:assignmentId/complete',
  authRequired,
  requireOwnership('studentId'),
  async (req, res) => {
    const doc = await DiagnosticAssignment.findOne({
      assignmentId: req.params.assignmentId,
      studentId: req.params.studentId,
    });
    if (!doc) return res.status(404).json({ error: 'not_found' });
    if (doc.status === 'completed') return res.status(409).json({ error: 'already_completed' });
    doc.status = 'completed';
    doc.completedAt = new Date();
    doc.score = req.body.score != null ? Number(req.body.score) : doc.maxMarks;
    await doc.save();
    await notify(req.params.studentId, 'diagnostic_completed', { assignmentId: doc.assignmentId });
    return res.json({ assignment: doc });
  }
);

router.get('/diagnostics/:studentId', authRequired, requireOwnership('studentId'), async (req, res) => {
  const assigned = await DiagnosticAssignment.find({ studentId: req.params.studentId }).sort({
    createdAt: -1,
  });
  return res.json({ studentId: req.params.studentId, assignments: assigned });
});

// --- Quiz select + submit ---
router.get('/quiz/:studentId', authRequired, requireOwnership('studentId'), async (req, res) => {
  const dir = latestSyntheticDir();
  if (!dir) return res.status(404).json({ error: 'synthetic_data_missing' });
  const topicId = req.query.topicId;
  if (!topicId) return res.status(400).json({ error: 'topicId_required' });
  const questions = readCsv(path.join(dir, 'questions.csv')).filter((q) => q.topic_id === topicId);
  const prior = await QuizAttempt.find({ studentId: req.params.studentId });
  const scores = prior.map((a) => a.score).filter((x) => x != null);
  const est = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0.5;
  const ranked = questions
    .map((q) => ({
      questionId: q.question_id,
      text: q.text,
      options: q.options,
      answerOrRubric: q.answer_or_rubric,
      difficulty: Number(q.difficulty),
      explanation: q.explanation,
      explanationReviewStatus: q.review_status,
      sourceReference: q.source_reference,
      diffGap: Math.abs(Number(q.difficulty) - est),
    }))
    .sort((a, b) => a.diffGap - b.diffGap)
    .slice(0, Number(req.query.n || 5));
  return res.json({
    studentId: req.params.studentId,
    topicId,
    estimatedScore: est,
    questions: ranked.map(({ answerOrRubric, ...rest }) => rest), // do not leak answers in GET
    _scoringKeyAvailableServerSide: true,
    selectionPolicy: 'difficulty_near_estimated_score',
  });
});

router.post(
  '/quiz/:studentId/submit',
  authRequired,
  requireOwnership('studentId'),
  async (req, res) => {
    const { questionId, topicId, response, curriculumVersion, curriculum_version } = req.body || {};
    if (!questionId) return res.status(400).json({ error: 'questionId_required' });
    const cv = String(curriculumVersion || curriculum_version || '').trim();
    // Canonical curriculum mode: reject topics that are neither synthetic legacy nor known pattern
    if (cv.includes('nie_al_arts') && topicId) {
      const syn = isSyntheticTopicId(topicId);
      const canon = isCanonicalTopicId(topicId);
      if (!syn && !canon) {
        return res.status(400).json({
          error: 'unsupported_topic_id',
          topicId,
          curriculumVersion: cv,
          note: 'Topic is neither synthetic legacy nor canonical provisional ID; mapping not approved',
        });
      }
      if (canon) {
        // Direct submit without assignment is not allowed — use assign endpoint
        const { filter: elig } = eligibleCatalogueFilter(
          {
            curriculumVersion: cv || CURRICULUM_VERSION,
            topicId,
            questionType: { $ne: 'essay_rubric' },
          },
          req.body.contentPolicy || req.query.contentPolicy
        );
        const nEligible = await CanonicalQuestion.countDocuments(elig);
        return res.status(409).json({
          error: nEligible > 0 ? 'canonical_assignment_required' : 'canonical_question_bank_unavailable',
          topicId,
          curriculumVersion: cv || CURRICULUM_VERSION,
          nEligiblePracticeQuestions: nEligible,
          contentPolicy: resolveContentPolicy(req.body.contentPolicy || req.query.contentPolicy),
          nextStep:
            nEligible > 0
              ? 'POST /learning/quiz/:studentId/assign with catalogueMode=canonical'
              : 'Import, validate, and publish-practice (or teacher-review) questions before assignment',
          note: 'Never silently substitute synthetic questions for canonical requests',
        });
      }
    }
    const dir = latestSyntheticDir();
    let score = 0;
    let maxMarks = 1;
    let answer = null;
    try {
      if (dir) {
        const q = readCsv(path.join(dir, 'questions.csv')).find((x) => x.question_id === questionId);
        if (q) {
          answer = q.answer_or_rubric;
          maxMarks = finiteMarks(q.max_marks, 1) || 1;
          score = String(response).trim() === String(answer).trim() ? maxMarks : 0;
        }
      }
    } catch (e) {
      return res.status(500).json({ error: 'quiz_scoring_failed', detail: String(e.message || e) });
    }
    const attemptId = `att_${uuidv4().slice(0, 10)}`;
    const attempt = await QuizAttempt.create({
      attemptId,
      studentId: req.params.studentId,
      questionId,
      topicId,
      response,
      score: Number.isFinite(score) ? score : 0,
      maxMarks: Number.isFinite(maxMarks) ? maxMarks : 1,
      gradingMethod: 'auto',
    });
    const topicAttempts = await QuizAttempt.find({
      studentId: req.params.studentId,
      ...(topicId ? { topicId } : {}),
    });
    const meanScore =
      topicAttempts.reduce((s, a) => s + (a.score || 0), 0) / Math.max(topicAttempts.length, 1);
    await ProgressSnapshot.findOneAndUpdate(
      { studentId: req.params.studentId, topicId: topicId || null },
      {
        studentId: req.params.studentId,
        topicId: topicId || null,
        nAttempts: topicAttempts.length,
        meanScore,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
      },
      { upsert: true, new: true }
    );
    await notify(req.params.studentId, 'quiz_submitted', { attemptId, score });
    return res.status(201).json({
      attempt,
      progressUpdated: true,
      observed_topic_performance: topicId
        ? { [topicId]: { meanScore, nAttempts: topicAttempts.length } }
        : {},
      estimated_mastery: null,
      estimated_mastery_note:
        'Observed quiz scores only — not labelled validated cognitive mastery',
      curriculumVersion: cv || null,
      mapping_status: topicId && isSyntheticTopicId(topicId) ? 'synthetic_legacy' : null,
    });
  }
);

router.get('/quiz/:studentId/history', authRequired, requireOwnership('studentId'), async (req, res) => {
  const { listQuizHistory } = require('../services/quizHistory');
  const history = await listQuizHistory({
    studentId: req.params.studentId,
    subjectId: req.query.subjectId || undefined,
    status: req.query.status || undefined,
    limit: req.query.limit,
    skip: req.query.skip,
  });
  return res.json(history);
});

router.get('/onboarding/:studentId', authRequired, requireOwnership('studentId'), async (req, res) => {
  const User = require('../models/User');
  const user = await User.findOne({ studentId: req.params.studentId }).lean();
  if (!user) return res.status(404).json({ error: 'student_not_found' });
  return res.json({
    onboardingStatus: user.onboardingStatus || 'not_required',
    onboardingAssignmentId: user.onboardingAssignmentId || null,
  });
});

router.post('/onboarding/:studentId/start', authRequired, requireOwnership('studentId'), async (req, res) => {
  const { startOrResumeOnboarding } = require('../services/onboarding');
  const out = await startOrResumeOnboarding(req.params.studentId);
  return res.status(out.status).json(out.body);
});

// --- Canonical quiz assign (eligibility-based; freezes question versions) ---
router.post(
  '/quiz/:studentId/assign',
  authRequired,
  requireOwnership('studentId'),
  async (req, res) => {
    const catalogueMode = String(req.body.catalogueMode || 'canonical').toLowerCase();
    if (catalogueMode !== 'canonical') {
      return res.status(400).json({ error: 'catalogueMode_must_be_canonical_for_assign' });
    }
    const curriculumVersion = req.body.curriculumVersion || CURRICULUM_VERSION;
    const subjectId = req.body.subjectId;
    const topicId = req.body.topicId;
    const language = String(req.body.language || 'en').toLowerCase();
    const nQuestions = Math.min(Math.max(Number(req.body.nQuestions || 3), 1), 20);
    const fixtureAccess = resolveFixtureAccess(req.body.allowTestFixtures);
    if (req.body.allowTestFixtures === true && !fixtureAccess.allowed) {
      return res.status(403).json({
        error: 'fixtures_not_enabled',
        reason: fixtureAccess.reason,
        note: 'Client allowTestFixtures cannot bypass server ARTS_AI_ALLOW_TEST_FIXTURES / production policy',
      });
    }
    if (!subjectId || !topicId) {
      return res.status(400).json({ error: 'subjectId_and_topicId_required' });
    }
    if (!isCanonicalTopicId(topicId)) {
      return res.status(400).json({ error: 'topicId_must_be_canonical' });
    }
    // Optional: allowTestFixtures path still uses approved fixtures when server allows
    let filter;
    let policyMeta;
    if (fixtureAccess.allowed && req.body.allowTestFixtures === true) {
      filter = applyFixtureFilter(
        {
          curriculumVersion,
          subjectId,
          topicId,
          language: language === 'english' ? 'en' : language,
          reviewStatus: 'approved_for_learner',
          questionType: { $in: ['mcq', 'short_answer', 'true_false', 'structured'] },
          retiredAt: null,
        },
        fixtureAccess
      );
      policyMeta = {
        policy: 'fixture_demo',
        learnerLabel: 'test_fixture',
        note: 'Isolated fixture demo path',
      };
    } else {
      const elig = eligibleCatalogueFilter(
        {
          curriculumVersion,
          subjectId,
          topicId,
          language: language === 'english' ? 'en' : language,
          questionType: { $in: ['mcq', 'short_answer', 'true_false', 'structured'] },
        },
        req.body.contentPolicy
      );
      filter = elig.filter;
      policyMeta = elig.resolved;
      policyMeta.learnerLabel = elig.learnerLabel;
    }
    const poolRaw = await CanonicalQuestion.find(filter).sort({ questionId: 1, version: -1 });
    // One eligible version per questionId (prefer higher version string / first after sort)
    const seenQ = new Set();
    const pool = [];
    for (const q of poolRaw) {
      if (seenQ.has(q.questionId)) continue;
      seenQ.add(q.questionId);
      pool.push(q);
    }
    if (pool.length < nQuestions) {
      return res.status(409).json({
        error: 'canonical_question_bank_unavailable',
        reason: 'insufficient_eligible_questions',
        requested: nQuestions,
        available: pool.length,
        curriculumVersion,
        subjectId,
        topicId,
        language,
        contentPolicy: policyMeta,
        fixturesAllowed: fixtureAccess.allowed,
        note: 'Rejected/retired/fixture (unless demo) and unpublished drafts excluded; no synthetic substitution',
      });
    }
    const selected = pool.slice(0, nQuestions);
    const frozen = selected.map((q) => ({
      questionId: q.questionId,
      version: q.version,
      questionType: q.questionType,
      prompt: q.prompt,
      options: q.options,
      correctAnswerOrRubric: q.correctAnswerOrRubric,
      maxMarks: q.maxMarks || 1,
      contentHash: q.contentHash,
      isTestFixture: !!q.isTestFixture,
      contentOrigin: q.contentOrigin || null,
      humanReviewStatus: q.humanReviewStatus || 'unreviewed',
    }));
    const allFixture = selected.every((q) => q.isTestFixture);
    const assignmentId = `cq_${uuidv4().slice(0, 10)}`;
    const assignment = await QuizAssignment.create({
      assignmentId,
      studentId: req.params.studentId,
      curriculumVersion,
      subjectId,
      topicId,
      language: filter.language,
      catalogueMode: 'canonical',
      status: 'assigned',
      questions: frozen,
      maxMarks: frozen.reduce((s, q) => s + (q.maxMarks || 1), 0),
      isTestFixture: allFixture,
      dataOrigin: allFixture
        ? 'canonical_quiz_test_fixture'
        : selected.some((q) => q.contentOrigin === 'ai_authored_source_grounded')
          ? 'canonical_quiz_ai_practice'
          : 'canonical_quiz',
    });
    await notify(req.params.studentId, 'canonical_quiz_assigned', {
      assignmentId,
      topicId,
      isTestFixture: allFixture,
    });
    const studentQuestions = frozen.map(({ correctAnswerOrRubric, ...rest }) => ({
      ...rest,
      provenanceLabels: learnerFacingProvenance(rest).labels,
    }));
    return res.status(201).json({
      assignmentId,
      curriculumVersion,
      subjectId,
      topicId,
      language: filter.language,
      nQuestions: studentQuestions.length,
      questions: studentQuestions,
      answerKeysIncluded: false,
      status: 'assigned',
      isTestFixture: assignment.isTestFixture,
      contentPolicy: policyMeta,
      learnerFacingNote:
        'Practice items may be AI-authored and not teacher-reviewed unless labelled otherwise',
      note: 'Scoring uses frozen assigned versions; essay_rubric not auto-assigned',
    });
  }
);

router.post(
  '/quiz/:studentId/assignments/:assignmentId/submit',
  authRequired,
  requireOwnership('studentId'),
  async (req, res) => {
    const responses = Array.isArray(req.body.responses) ? req.body.responses : [];
    // testHooks only honored when server fixtures enabled (isolated tests)
    const testHooks =
      resolveFixtureAccess(true).serverEnabled && req.body.__testFailAfter
        ? { failAfter: req.body.__testFailAfter }
        : {};
    try {
      const out = await submitCanonicalAssignment({
        studentId: req.params.studentId,
        assignmentId: req.params.assignmentId,
        responses,
        testHooks,
      });
      return res.status(out.status).json(out.body);
    } catch (err) {
      if (err && err.testInjected) {
        return res.status(500).json({
          error: 'submission_interrupted',
          injected: err.message,
          note: 'Assignment left recoverable in submitting with pending payload',
        });
      }
      throw err;
    }
  }
);

/** Staff recovery for expired submitting leases (does not blindly reset to assigned). */
router.post(
  '/quiz/recover-stuck-submissions',
  authRequired,
  requireRole('teacher', 'admin'),
  async (req, res) => {
    const report = await recoverStuckSubmissions({
      limit: Math.min(Number(req.body.limit || 50), 200),
    });
    return res.json(report);
  }
);

router.get(
  '/quiz/:studentId/assignments/:assignmentId',
  authRequired,
  requireOwnership('studentId'),
  async (req, res) => {
    const assignment = await QuizAssignment.findOne({
      assignmentId: req.params.assignmentId,
      studentId: req.params.studentId,
    }).lean();
    if (!assignment) return res.status(404).json({ error: 'assignment_not_found' });
    const questions = (assignment.questions || []).map(
      ({ correctAnswerOrRubric, ...rest }) => rest
    );
    return res.json({
      ...assignment,
      questions,
      answerKeysIncluded: false,
    });
  }
);

// --- Recommendations (configurable policyMode; same eligibility for both) ---
router.get(
  '/recommendations/:studentId',
  authRequired,
  requireOwnership('studentId'),
  async (req, res) => {
    const catalogueModeEarly = String(req.query.catalogueMode || 'synthetic_historical').toLowerCase();
    // Canonical catalogue: recommend approved resources only; ranker always falls back
    if (catalogueModeEarly === 'canonical' || catalogueModeEarly === 'curriculum') {
      const curriculumVersion = req.query.curriculumVersion || CURRICULUM_VERSION;
      const subjectId = req.query.subjectId;
      const fixtureAccess = resolveFixtureAccess(req.query.allowTestFixtures);
      if (req.query.allowTestFixtures === 'true' && !fixtureAccess.allowed) {
        return res.status(403).json({
          error: 'fixtures_not_enabled',
          reason: fixtureAccess.reason,
        });
      }
      const base = { curriculumVersion };
      if (subjectId) base.subjectId = subjectId;
      let filter;
      let contentPolicyMeta;
      if (fixtureAccess.allowed && req.query.allowTestFixtures === 'true') {
        filter = applyFixtureFilter(
          { ...base, reviewStatus: 'approved_for_learner', retiredAt: null },
          fixtureAccess
        );
        contentPolicyMeta = { policy: 'fixture_demo' };
      } else {
        const elig = eligibleCatalogueFilter(base, req.query.contentPolicy);
        filter = elig.filter;
        contentPolicyMeta = elig.resolved;
      }
      const resources = await CanonicalResource.find(filter).lean();
      // Prerequisite practice: non-fixture attempts only unless fixture demo
      const attemptFilter = fixtureAccess.allowed && req.query.allowTestFixtures === 'true'
        ? { studentId: req.params.studentId }
        : { studentId: req.params.studentId, isTestFixture: false };
      const attempts = await QuizAttempt.find(attemptFilter);
      const practised = new Set(attempts.map((a) => a.topicId).filter(Boolean));
      const eligible = resources.filter((r) => {
        const prereq = r.prerequisiteTopicIds || [];
        return prereq.every((p) => practised.has(p));
      });
      const limit = Number(req.query.limit || 10);
      const recommendations = eligible.slice(0, limit).map((r, i) => {
        const prov = learnerFacingProvenance(r);
        return {
          resourceId: r.resourceId,
          topicId: (r.topicIds || [])[0],
          language: r.language,
          title: r.title,
          score: practised.has((r.topicIds || [])[0]) ? 0.3 : 1.0,
          rank: i + 1,
          reason: 'canonical_prerequisite_aware',
          version: r.version,
          reviewStatus: r.reviewStatus,
          contentOrigin: r.contentOrigin,
          humanReviewStatus: r.humanReviewStatus,
          learnerAvailability: r.learnerAvailability,
          provenanceLabels: prov.labels,
          isTestFixture: !!r.isTestFixture,
        };
      });
      const requestedMode = String(
        req.query.policyMode || config.recommendationPolicy || 'prerequisite_aware'
      )
        .trim()
        .toLowerCase();
      let fallbackReason = null;
      let trainedScorerUsed = false;
      let policyMode = 'prerequisite_aware';
      if (requestedMode === 'trained_ranker') {
        fallbackReason = 'topic_vocabulary_incompatible_canonical_catalogue';
        policyMode = 'prerequisite_aware';
        trainedScorerUsed = false;
      }
      return res.json({
        studentId: req.params.studentId,
        subjectId: subjectId || null,
        recommendations,
        policyMode,
        contentPolicy: contentPolicyMeta,
        trainedScorerUsed,
        modelVersion: 'prerequisite_aware_v0',
        fallbackReason,
        catalogueMode: 'canonical',
        curriculumVersion,
        rankerCompatibility: 'incompatible_canonical_curriculum',
        nEligible: eligible.length,
        simulationOnly: false,
        fixturesAllowed: fixtureAccess.allowed,
        isTestFixture: fixtureAccess.allowed && recommendations.some((r) => r.isTestFixture),
        note:
          recommendations.length === 0
            ? 'No eligible published practice / reviewed canonical resources'
            : 'Canonical prerequisite-aware recommendations; trained ranker not used',
      });
    }

    const dir = latestSyntheticDir();
    if (!dir) return res.status(404).json({ error: 'synthetic_data_missing' });
    const meta = latestRankerMeta();
    const requestedMode = String(
      req.query.policyMode || config.recommendationPolicy || 'prerequisite_aware'
    )
      .trim()
      .toLowerCase();
    const attempts = await QuizAttempt.find({ studentId: req.params.studentId });
    const practised = new Set(
      attempts.map((a) => String(a.questionId || '').replace(/_q\d+$/, ''))
    );
    const { subjectId: sid, eligible } = buildEligibleCandidates(
      dir,
      req.params.studentId,
      req.query.subjectId,
      practised
    );
    const limit = Number(req.query.limit || 10);
    let policyMode = 'prerequisite_aware';
    let trainedScorerUsed = false;
    let modelVersion = meta.modelVersion || 'prerequisite_aware_v0';
    let fallbackReason = null;
    let recommendations = [];

    const catalogueMode = String(req.query.catalogueMode || 'synthetic_historical').toLowerCase();
    const curriculumVersion = String(
      req.query.curriculumVersion || req.query.curriculum_version || ''
    );
    let rankerCompatibility = rankerCatalogueCompatibility(
      eligible,
      catalogueMode,
      curriculumVersion
    );

    if (requestedMode === 'trained_ranker') {
      policyMode = 'trained_ranker';
      if (!meta.artifactPresent) {
        fallbackReason = 'ranker_artifact_unavailable';
        policyMode = 'prerequisite_aware';
        trainedScorerUsed = false;
      } else if (!rankerCompatibility.ok) {
        // Incompatible canonical / mixed vocab — documented prerequisite fallback
        fallbackReason = rankerCompatibility.reason;
        policyMode = 'prerequisite_aware';
        trainedScorerUsed = false;
        modelVersion = 'prerequisite_aware_v0';
      } else {
        try {
          const openRate =
            attempts.length > 0
              ? attempts.filter((a) => (a.score || 0) > 0).length / attempts.length
              : 0.5;
          const scored = await mlFetch('/v1/recommendations/score', {
            method: 'POST',
            body: JSON.stringify({
              student_id: req.params.studentId,
              stu_open_rate: openRate,
              candidates: eligible.map((e) => ({
                resource_id: e.resourceId,
                difficulty: e.difficulty,
                topic_id: e.topicId,
              })),
            }),
          });
          if (!scored.ok || !scored.trainedScorerUsed) {
            fallbackReason = scored.fallbackReason || 'ranker_score_failed';
            policyMode = 'prerequisite_aware';
            trainedScorerUsed = false;
          } else {
            trainedScorerUsed = true;
            modelVersion = scored.modelVersion || meta.modelVersion;
            const byId = new Map(eligible.map((e) => [e.resourceId, e]));
            recommendations = (scored.scores || []).slice(0, limit).map((s, i) => {
              const base = byId.get(s.resourceId) || {};
              return {
                resourceId: s.resourceId,
                topicId: s.topicId || base.topicId,
                score: s.score,
                rank: i + 1,
                reason: s.reason || 'trained_pointwise_open_probability',
                eligibility: base.reasonPrereq,
              };
            });
          }
        } catch (e) {
          fallbackReason = `ml_unreachable:${e.message || e}`;
          policyMode = 'prerequisite_aware';
          trainedScorerUsed = false;
        }
      }
    }

    if (policyMode === 'prerequisite_aware') {
      recommendations = eligible
        .slice()
        .sort((a, b) => b.prerequisiteScore - a.prerequisiteScore)
        .slice(0, limit)
        .map((r, i) => ({
          resourceId: r.resourceId,
          topicId: r.topicId,
          score: r.prerequisiteScore,
          rank: i + 1,
          reason: r.reasonPrereq,
          eligibility: r.reasonPrereq,
        }));
      if (!trainedScorerUsed && !fallbackReason && requestedMode !== 'trained_ranker') {
        modelVersion = 'prerequisite_aware_v0';
      }
    }

    console.log(
      `[recommendations] student=${req.params.studentId} requested=${requestedMode} served=${policyMode} trained=${trainedScorerUsed} fallback=${fallbackReason || 'none'}`
    );

    return res.json({
      studentId: req.params.studentId,
      subjectId: sid,
      recommendations,
      policyMode,
      policy: policyMode, // backward compatible alias
      trainedScorerUsed,
      modelVersion,
      modelOrPolicyVersion: modelVersion,
      fallbackReason,
      catalogueMode,
      curriculumVersion: curriculumVersion || null,
      rankerCompatibility: rankerCompatibility.compatibility,
      nEligible: eligible.length,
      simulationOnly: true,
      note:
        'Default policyMode=prerequisite_aware. trained_ranker is opt-in for historical synthetic catalogue only. Canonical curriculum requests fall back with topic_vocabulary_incompatible_*. trainedScorerUsed=true only when the saved model scored compatible inputs.',
    });
  }
);

// --- Peer groups with capacity + join request/approval ---
router.post('/peer-groups', authRequired, requireRole('student', 'admin'), async (req, res) => {
  const { name, subjectId, topicId, studentId, maxMembers, requireApproval } = req.body || {};
  const sid = req.user.role === 'student' ? req.user.studentId : studentId;
  if (!sid || !name || !subjectId) return res.status(400).json({ error: 'missing_fields' });
  const groupId = `grp_${uuidv4().slice(0, 8)}`;
  const group = await PeerGroup.create({
    groupId,
    name,
    subjectId,
    topicId,
    createdByStudentId: sid,
    maxMembers: maxMembers || 20,
    memberCount: 1,
    requireApproval: !!requireApproval,
  });
  await GroupMembership.create({ groupId, studentId: sid, role: 'owner' });
  await notify(sid, 'peer_group_created', { groupId });
  return res.status(201).json({ group });
});

router.post(
  '/peer-groups/:groupId/join-request',
  authRequired,
  requireRole('student', 'admin'),
  async (req, res) => {
    const sid = req.user.role === 'student' ? req.user.studentId : req.body.studentId;
    const group = await PeerGroup.findOne({ groupId: req.params.groupId });
    if (!group) return res.status(404).json({ error: 'group_not_found' });
    const existingMember = await GroupMembership.findOne({ groupId: group.groupId, studentId: sid });
    if (existingMember) return res.status(409).json({ error: 'already_member' });
    const pending = await JoinRequest.findOne({
      groupId: group.groupId,
      studentId: sid,
      status: 'requested',
    });
    if (pending) return res.status(409).json({ error: 'join_request_pending', requestId: pending.requestId });
    const occupied =
      group.memberCount != null
        ? group.memberCount
        : await GroupMembership.countDocuments({ groupId: group.groupId });
    if (occupied >= (group.maxMembers || 20)) return res.status(409).json({ error: 'capacity_full' });
    if (!group.requireApproval) {
      const slot = await claimMembershipSlot(group);
      if (!slot) return res.status(409).json({ error: 'capacity_full' });
      try {
        const membership = await GroupMembership.create({
          groupId: group.groupId,
          studentId: sid,
          role: 'member',
        });
        await notify(sid, 'peer_group_joined', { groupId: group.groupId });
        await notify(group.createdByStudentId, 'peer_group_member_joined', {
          groupId: group.groupId,
          studentId: sid,
        });
        return res.status(201).json({ membership, status: 'joined' });
      } catch (e) {
        await releaseMembershipSlot(group.groupId);
        if (e && e.code === 11000) return res.status(409).json({ error: 'already_member' });
        throw e;
      }
    }
    const requestId = `jreq_${uuidv4().slice(0, 8)}`;
    try {
      const jr = await JoinRequest.create({
        requestId,
        groupId: group.groupId,
        studentId: sid,
        status: 'requested',
      });
      await notify(group.createdByStudentId, 'peer_join_requested', { requestId, studentId: sid });
      return res.status(201).json({ joinRequest: jr });
    } catch (e) {
      if (e && e.code === 11000) {
        const existing = await JoinRequest.findOne({
          groupId: group.groupId,
          studentId: sid,
          status: 'requested',
        });
        return res.status(409).json({
          error: 'join_request_pending',
          requestId: existing ? existing.requestId : null,
        });
      }
      throw e;
    }
  }
);

router.post('/peer-groups/:groupId/join', authRequired, requireRole('student', 'admin'), async (req, res) => {
  // Backward-compatible alias → join-request without approval
  req.url = `/peer-groups/${req.params.groupId}/join-request`;
  const group = await PeerGroup.findOne({ groupId: req.params.groupId });
  if (group) group.requireApproval = false;
  const sid = req.user.role === 'student' ? req.user.studentId : req.body.studentId;
  if (!group) return res.status(404).json({ error: 'group_not_found' });
  const existing = await GroupMembership.findOne({ groupId: group.groupId, studentId: sid });
  if (existing) return res.status(409).json({ error: 'already_member' });
  const slot = await claimMembershipSlot(group);
  if (!slot) return res.status(409).json({ error: 'capacity_full' });
  try {
    const membership = await GroupMembership.create({
      groupId: group.groupId,
      studentId: sid,
      role: 'member',
    });
    await notify(sid, 'peer_group_joined', { groupId: group.groupId });
    await notify(group.createdByStudentId, 'peer_group_member_joined', {
      groupId: group.groupId,
      studentId: sid,
    });
    return res.status(201).json({ membership });
  } catch (e) {
    await releaseMembershipSlot(group.groupId);
    if (e.code === 11000) return res.status(409).json({ error: 'already_member' });
    throw e;
  }
});

async function canManageGroup(user, group) {
  if (!user || !group) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'student' && user.studentId === group.createdByStudentId) return true;
  if (user.role !== 'student' || !user.studentId) return false;
  const membership = await GroupMembership.findOne({
    groupId: group.groupId,
    studentId: user.studentId,
    role: { $in: ['owner', 'moderator'] },
  });
  return !!membership;
}

router.get(
  '/peer-groups/:groupId/join-requests',
  authRequired,
  async (req, res) => {
    const group = await PeerGroup.findOne({ groupId: req.params.groupId });
    if (!group) return res.status(404).json({ error: 'group_not_found' });
    if (!(await canManageGroup(req.user, group))) {
      return res.status(403).json({ error: 'forbidden_ownership' });
    }
    const joinRequests = await JoinRequest.find({
      groupId: group.groupId,
      status: 'requested',
    }).select('requestId groupId studentId status createdAt');
    return res.json({ joinRequests });
  }
);

router.post(
  '/peer-groups/:groupId/join-requests/:requestId/approve',
  authRequired,
  async (req, res) => {
    const group = await PeerGroup.findOne({ groupId: req.params.groupId });
    if (!group) return res.status(404).json({ error: 'group_not_found' });
    if (!(await canManageGroup(req.user, group))) {
      return res.status(403).json({ error: 'forbidden_ownership' });
    }
    const existing = await JoinRequest.findOne({
      requestId: req.params.requestId,
      groupId: group.groupId,
    });
    if (!existing) return res.status(404).json({ error: 'request_not_found' });
    if (existing.status === 'approved') {
      const membership = await GroupMembership.findOne({
        groupId: group.groupId,
        studentId: existing.studentId,
      });
      return res.json({ joinRequest: existing, membership, idempotent: true });
    }
    if (existing.status !== 'requested') {
      return res.status(409).json({ error: `illegal_state_${existing.status}` });
    }
    const jr = await JoinRequest.findOneAndUpdate(
      { _id: existing._id, status: 'requested' },
      { $set: { status: 'approved' } },
      { new: true }
    );
    if (!jr) {
      const again = await JoinRequest.findOne({ _id: existing._id });
      const membership = again
        ? await GroupMembership.findOne({ groupId: group.groupId, studentId: again.studentId })
        : null;
      return res.status(409).json({ error: 'join_request_not_pending', membership });
    }
    const already = await GroupMembership.findOne({
      groupId: group.groupId,
      studentId: jr.studentId,
    });
    if (already) return res.json({ joinRequest: jr, membership: already, idempotent: true });
    const slot = await claimMembershipSlot(group);
    if (!slot) {
      await JoinRequest.updateOne({ _id: jr._id }, { $set: { status: 'requested' } });
      return res.status(409).json({ error: 'capacity_full' });
    }
    try {
      const membership = await GroupMembership.create({
        groupId: group.groupId,
        studentId: jr.studentId,
        role: 'member',
      });
      await notify(jr.studentId, 'peer_join_approved', { groupId: group.groupId });
      return res.json({ joinRequest: jr, membership });
    } catch (e) {
      await releaseMembershipSlot(group.groupId);
      if (e && e.code === 11000) {
        const membership = await GroupMembership.findOne({
          groupId: group.groupId,
          studentId: jr.studentId,
        });
        return res.json({ joinRequest: jr, membership, idempotent: true });
      }
      await JoinRequest.updateOne({ _id: jr._id }, { $set: { status: 'requested' } });
      throw e;
    }
  }
);

router.get('/peer-groups/mine', authRequired, async (req, res) => {
  const sid = req.user.studentId;
  if (!sid) return res.status(403).json({ error: 'student_account_required' });
  const memberships = await GroupMembership.find({ studentId: sid }).lean();
  const ids = memberships.map((m) => m.groupId);
  const groups = await PeerGroup.find({ groupId: { $in: ids } }).lean();
  return res.json({
    groups: groups.map((g) => ({
      ...g,
      myRole: memberships.find((m) => m.groupId === g.groupId)?.role || 'member',
    })),
  });
});

router.get('/peer-groups/:groupId/members', authRequired, async (req, res) => {
  const group = await PeerGroup.findOne({ groupId: req.params.groupId });
  if (!group) return res.status(404).json({ error: 'group_not_found' });
  if (req.user.role !== 'admin') {
    const mine = await GroupMembership.findOne({
      groupId: group.groupId,
      studentId: req.user.studentId,
    });
    if (!mine) return res.status(403).json({ error: 'forbidden_ownership' });
  }
  const members = await GroupMembership.find({ groupId: req.params.groupId }).select(
    'groupId studentId role joinedAt'
  );
  return res.json({ members });
});

router.get('/notifications/me', authRequired, async (req, res) => {
  const userId = req.user.studentId || req.user.teacherId || req.user.sub;
  const list = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(50);
  return res.json({ notifications: list });
});

router.post('/notifications/:notificationId/read', authRequired, async (req, res) => {
  const userId = req.user.studentId || req.user.teacherId || req.user.sub;
  const doc = await Notification.findOneAndUpdate(
    { notificationId: req.params.notificationId, userId },
    { $set: { read: true } },
    { new: true }
  );
  if (!doc) return res.status(404).json({ error: 'not_found' });
  return res.json({ notification: doc });
});

router.post('/risk/:studentId/predict', authRequired, requireOwnership('studentId'), async (req, res) => {
  try {
    const out = await mlFetch('/v1/risk/predict', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    return res.json(out);
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message, detail: e.body });
  }
});

module.exports = router;
