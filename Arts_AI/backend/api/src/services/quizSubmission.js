/**
 * Durable, recoverable canonical quiz submission.
 * Compatible with standalone Mongo (no multi-doc transactions required).
 */
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { QuizAssignment } = require('../models/Catalogue');
const { QuizAttempt, ProgressSnapshot } = require('../models/LearningRecords');
const { Notification } = require('../models/PeerGroup');
const DigitalTwinProfile = require('../models/DigitalTwinProfile');
const { TwinHead } = DigitalTwinProfile;

/** In-process test barrier. Not wired to any HTTP route. */
let twinCommitHook = null;

function setTwinCommitHook(fn) {
  twinCommitHook = typeof fn === 'function' ? fn : null;
}

const LEASE_MS = Number(process.env.ARTS_AI_SUBMIT_LEASE_MS || 30000);

function fingerprintResponses(responses) {
  const norm = (Array.isArray(responses) ? responses : [])
    .map((r) => ({
      questionId: String(r.questionId || ''),
      response: String(r.response ?? '').trim(),
    }))
    .sort((a, b) => a.questionId.localeCompare(b.questionId));
  return crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

function gradeAssignment(assignment, responses) {
  const byId = new Map(assignment.questions.map((q) => [q.questionId, q]));
  const graded = [];
  let total = 0;
  let maxTotal = 0;
  for (const r of responses) {
    const q = byId.get(r.questionId);
    if (!q) {
      return { error: 'invalid_question_id', questionId: r.questionId, status: 400 };
    }
    if (q.questionType === 'essay_rubric') {
      return {
        error: 'essay_auto_grading_unavailable',
        questionId: q.questionId,
        status: 409,
        note: 'Essay items require manual marking; not simulated ML grading',
      };
    }
    const maxMarks = q.maxMarks || 1;
    maxTotal += maxMarks;
    const score =
      String(r.response ?? '').trim() === String(q.correctAnswerOrRubric).trim() ? maxMarks : 0;
    total += score;
    graded.push({
      questionId: q.questionId,
      response: String(r.response ?? ''),
      score,
      maxMarks,
    });
  }
  if (graded.length !== assignment.questions.length) {
    return {
      error: 'incomplete_responses',
      expected: assignment.questions.length,
      received: graded.length,
      status: 400,
    };
  }
  return { graded, total, maxTotal };
}

function classifyAttempt(a) {
  if (a.isTestFixture === true) return 'fixture';
  if (a.isTestFixture === false) return 'authentic';
  if (a.dataOrigin && /fixture|test_fixture/i.test(String(a.dataOrigin))) return 'fixture';
  return 'unknown'; // missing provenance ≠ authentic
}

async function rebuildProgress(studentId, topicId) {
  const topicAttempts = await QuizAttempt.find({ studentId, topicId });
  const authentic = topicAttempts.filter((a) => classifyAttempt(a) === 'authentic');
  const fixtures = topicAttempts.filter((a) => classifyAttempt(a) === 'fixture');
  const unknown = topicAttempts.filter((a) => classifyAttempt(a) === 'unknown');
  const mean = (rows) =>
    rows.length ? rows.reduce((s, a) => s + (a.score || 0), 0) / rows.length : null;
  await ProgressSnapshot.findOneAndUpdate(
    { studentId, topicId },
    {
      studentId,
      topicId,
      nAttempts: topicAttempts.length,
      meanScore: mean(topicAttempts),
      nAuthenticAttempts: authentic.length,
      authenticMeanScore: mean(authentic),
      nFixtureAttempts: fixtures.length,
      fixtureMeanScore: mean(fixtures),
      nUnknownProvenanceAttempts: unknown.length,
      includesTestFixtures: fixtures.length > 0,
      lastAttemptAt: new Date(),
      updatedAt: new Date(),
    },
    { upsert: true, new: true }
  );
  return {
    authentic,
    fixtures,
    unknown,
    authenticMean: mean(authentic),
    topicAttempts,
  };
}

/**
 * Persist observed quiz performance into Digital Twin (server aggregates only).
 * Does not run OULAD clustering or write Model Explorer demo inputs into Twin.
 */
function meanKnownScores(rows) {
  const scored = rows.filter((r) => typeof r.score === 'number' && Number.isFinite(r.score));
  if (!scored.length) return null;
  return scored.reduce((s, r) => s + r.score, 0) / scored.length;
}

function aggregateAttempts(attempts) {
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
    const auth = rows.filter((r) => classifyAttempt(r) === 'authentic');
    const fix = rows.filter((r) => classifyAttempt(r) === 'fixture');
    if (auth.length) {
      authenticPerf[tid] = {
        meanScore: meanKnownScores(auth),
        nAttempts: auth.length,
        provenance: 'recorded_practice_attempts',
      };
    }
    if (fix.length) {
      fixturePerf[tid] = {
        meanScore: meanKnownScores(fix),
        nAttempts: fix.length,
        provenance: 'fixture_attempts',
      };
    }
  }
  const dataCategory =
    Object.keys(fixturePerf).length && !Object.keys(authenticPerf).length
      ? 'test_fixture_learner'
      : 'synthetic_learner';
  return { authenticPerf, fixturePerf, dataCategory };
}

async function ensureTwinHead(studentId) {
  const existing = await TwinHead.findOne({ studentId });
  if (existing) return existing;
  const latest = await DigitalTwinProfile.findOne({ studentId }).sort({ profileVersion: -1 }).lean();
  const revision = latest ? latest.profileVersion : 0;
  try {
    return await TwinHead.create({ studentId, revision });
  } catch (e) {
    if (e && e.code === 11000) return TwinHead.findOne({ studentId });
    throw e;
  }
}

/**
 * Compare-and-set a Twin profile.
 * The base revision is captured before `build` reads aggregates.
 * A stale aggregate cannot be stored under a newer revision: the write matches the captured revision only.
 */
async function commitTwinRevision(studentId, build) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const head = await ensureTwinHead(studentId);
    const base = head.revision;
    const baseProfile =
      (await DigitalTwinProfile.findOne({ studentId, profileVersion: base }).lean()) ||
      (await DigitalTwinProfile.findOne({ studentId }).sort({ profileVersion: -1 }).lean());
    const payload = await build(baseProfile, base);
    if (twinCommitHook) {
      await twinCommitHook({
        studentId,
        baseRevision: base,
        evidenceCount: payload.evidence_count,
        phase: 'before_cas',
      });
    }
    const claimed = await TwinHead.findOneAndUpdate(
      { _id: head._id, revision: base },
      { $set: { revision: base + 1 } },
      { new: true }
    );
    if (!claimed) continue;
    const profileVersion = base + 1;
    payload.profile_version = profileVersion;
    try {
      return await DigitalTwinProfile.create({
        studentId,
        profileVersion,
        payload,
        dataCategory: payload.data_category,
      });
    } catch (e) {
      if (e && e.code === 11000) continue;
      throw e;
    }
  }
  const err = new Error('twin_revision_contention');
  err.code = 'twin_revision_contention';
  throw err;
}

async function syncObservedTwinFromAttempts(studentId, extras = {}) {
  return commitTwinRevision(studentId, async (baseProfile) => {
    const attempts = await QuizAttempt.find({ studentId });
    const agg = aggregateAttempts(attempts);
    const preserved =
      baseProfile && baseProfile.payload && typeof baseProfile.payload === 'object'
        ? { ...baseProfile.payload }
        : {};
    const evidenceCount = Object.values(agg.authenticPerf).reduce((s, t) => s + (t.nAttempts || 0), 0);
    return {
      ...preserved,
      ...extras,
      student_id: studentId,
      evidence_count: evidenceCount,
      evidence_count_fixture: Object.values(agg.fixturePerf).reduce((s, t) => s + (t.nAttempts || 0), 0),
      state: Object.keys(agg.authenticPerf).length ? 'ok' : 'insufficient_authentic_data',
      data_category: agg.dataCategory,
      observed_topic_performance: agg.authenticPerf,
      observed_topic_performance_fixture: agg.fixturePerf,
      canonical_topic_ids_seen: Object.keys(agg.authenticPerf),
      estimated_mastery: null,
      estimated_mastery_method: 'not_computed_insufficient_local_labels',
      weak_topics: Object.entries(agg.authenticPerf)
        .filter(([, v]) => typeof v.meanScore === 'number' && v.meanScore < 0.5)
        .map(([k]) => k),
      note: 'Recorded practice scores from quiz attempts — not validated mastery',
      source: extras.source || preserved.source || 'canonical_quiz_submission',
      cluster_id:
        extras.cluster_id !== undefined ? extras.cluster_id : preserved.cluster_id ?? null,
    };
  });
}

function injectFail(stage, testHooks) {
  if (testHooks && testHooks.failAfter === stage) {
    const err = new Error(`TEST_INJECT_FAIL_AFTER_${String(stage).toUpperCase()}`);
    err.testInjected = true;
    throw err;
  }
}

async function applyEffects(assignment, graded, total, maxTotal, ownerToken, testHooks = {}) {
  // Guard: only the lease owner may finalize
  const stillOwner = await QuizAssignment.findOne({
    _id: assignment._id,
    submissionOwnerToken: ownerToken,
    status: { $in: ['submitting', 'submitted'] },
  });
  if (!stillOwner) {
    return { ok: false, error: 'lease_lost' };
  }

  const effects = stillOwner.effectsApplied || {};

  if (!effects.attempts) {
    for (const g of graded) {
      const attemptId = `att_${uuidv4().slice(0, 10)}`;
      try {
        await QuizAttempt.create({
          attemptId,
          assignmentId: stillOwner.assignmentId,
          studentId: stillOwner.studentId,
          questionId: g.questionId,
          topicId: stillOwner.topicId,
          response: g.response,
          score: g.score,
          maxMarks: g.maxMarks,
          gradingMethod: 'auto_canonical_frozen',
          dataOrigin: stillOwner.dataOrigin,
          isTestFixture: !!stillOwner.isTestFixture,
        });
      } catch (e) {
        if (!(e && e.code === 11000)) throw e;
      }
    }
    await QuizAssignment.updateOne(
      { _id: stillOwner._id, submissionOwnerToken: ownerToken },
      { $set: { 'effectsApplied.attempts': true } }
    );
    injectFail('attempts', testHooks);
  }

  if (!effects.score) {
    const updated = await QuizAssignment.findOneAndUpdate(
      { _id: stillOwner._id, submissionOwnerToken: ownerToken },
      {
        $set: {
          responses: graded,
          score: total,
          maxMarks: maxTotal || stillOwner.maxMarks,
          'effectsApplied.score': true,
        },
      },
      { new: true }
    );
    if (!updated) return { ok: false, error: 'lease_lost' };
    injectFail('score', testHooks);
  }

  if (!effects.progress) {
    await rebuildProgress(stillOwner.studentId, stillOwner.topicId);
    await QuizAssignment.updateOne(
      { _id: stillOwner._id, submissionOwnerToken: ownerToken },
      { $set: { 'effectsApplied.progress': true } }
    );
  }

  if (!effects.twin) {
    await syncObservedTwinFromAttempts(stillOwner.studentId);
    injectFail('twin_written', testHooks);
    await QuizAssignment.updateOne(
      { _id: stillOwner._id, submissionOwnerToken: ownerToken },
      { $set: { 'effectsApplied.twin': true } }
    );
  }

  if (!effects.notification) {
    // Deterministic id → concurrent workers cannot double-notify
    const notificationId = `ntf_cq_${stillOwner.assignmentId}`;
    try {
      await Notification.create({
        notificationId,
        userId: stillOwner.studentId,
        type: 'canonical_quiz_submitted',
        payload: {
          assignmentId: stillOwner.assignmentId,
          score: total,
          isTestFixture: !!stillOwner.isTestFixture,
        },
      });
    } catch (e) {
      if (!(e && e.code === 11000)) throw e;
    }
    await QuizAssignment.updateOne(
      { _id: stillOwner._id, submissionOwnerToken: ownerToken },
      { $set: { 'effectsApplied.notification': true } }
    );
  }

  const done = await QuizAssignment.findOneAndUpdate(
    { _id: stillOwner._id, submissionOwnerToken: ownerToken },
    {
      $set: {
        status: 'submitted',
        submittedAt: new Date(),
        submissionLeaseUntil: null,
      },
    },
    { new: true }
  );
  if (!done) return { ok: false, error: 'lease_lost' };

  const prog = await rebuildProgress(done.studentId, done.topicId);
  return {
    ok: true,
    assignment: done,
    progress: prog,
  };
}

/**
 * Submit or resume a canonical quiz assignment.
 * @param {{ failAfter?: 'claim'|'attempts'|'score'|null }} testHooks - deterministic injection for tests only
 */
async function submitCanonicalAssignment({
  studentId,
  assignmentId,
  responses,
  testHooks = {},
}) {
  const fp = fingerprintResponses(responses);
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const ownerToken = uuidv4();

  // Already fully submitted — identical payload resumes result; different → conflict
  const existing = await QuizAssignment.findOne({ assignmentId, studentId });
  if (!existing) return { status: 404, body: { error: 'assignment_not_found' } };

  if (existing.status === 'submitted') {
    if (existing.pendingFingerprint && existing.pendingFingerprint !== fp) {
      return {
        status: 409,
        body: {
          error: 'submission_payload_conflict',
          assignmentId,
          note: 'Assignment already submitted with a different answer payload',
        },
      };
    }
    return {
      status: 409,
      body: {
        error: 'already_submitted',
        assignmentId,
        score: existing.score,
        note: 'Duplicate submission rejected — scores not re-applied',
      },
    };
  }

  if (existing.status === 'submitting') {
    const leaseActive =
      existing.submissionLeaseUntil && new Date(existing.submissionLeaseUntil) > now;
    if (leaseActive && existing.pendingFingerprint === fp) {
      // Same payload, lease still held — ask client to retry shortly OR allow same process resume via token (not available)
      return {
        status: 409,
        body: {
          error: 'submission_in_progress',
          assignmentId,
          retryAfterMs: Math.max(
            0,
            new Date(existing.submissionLeaseUntil).getTime() - now.getTime()
          ),
        },
      };
    }
    if (leaseActive && existing.pendingFingerprint !== fp) {
      return {
        status: 409,
        body: {
          error: 'submission_payload_conflict',
          assignmentId,
          note: 'Another submission with a different payload is in progress',
        },
      };
    }
    // Lease expired — claim ownership if fingerprint matches or no fingerprint yet
    if (existing.pendingFingerprint && existing.pendingFingerprint !== fp) {
      return {
        status: 409,
        body: {
          error: 'submission_payload_conflict',
          assignmentId,
          note: 'Accepted payload fingerprint differs from retry',
        },
      };
    }
    const claimed = await QuizAssignment.findOneAndUpdate(
      {
        _id: existing._id,
        status: 'submitting',
        $or: [
          { submissionLeaseUntil: null },
          { submissionLeaseUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          submissionOwnerToken: ownerToken,
          submissionLeaseUntil: leaseUntil,
          pendingResponses: responses,
          pendingFingerprint: fp,
        },
      },
      { new: true }
    );
    if (!claimed) {
      return {
        status: 409,
        body: { error: 'submission_in_progress', assignmentId },
      };
    }
    return finishSubmission(claimed, responses, ownerToken, testHooks);
  }

  // Fresh claim from assigned
  const gradedPreview = gradeAssignment(existing, responses);
  if (gradedPreview.error) {
    return {
      status: gradedPreview.status || 400,
      body: gradedPreview,
    };
  }

  const claimed = await QuizAssignment.findOneAndUpdate(
    { assignmentId, studentId, status: 'assigned' },
    {
      $set: {
        status: 'submitting',
        submissionLockAt: now,
        submissionLeaseUntil: leaseUntil,
        submissionOwnerToken: ownerToken,
        pendingResponses: responses,
        pendingFingerprint: fp,
        effectsApplied: {
          attempts: false,
          score: false,
          progress: false,
          twin: false,
          notification: false,
        },
      },
    },
    { new: true }
  );
  if (!claimed) {
    // Race: someone else claimed — re-enter logic
    return submitCanonicalAssignment({ studentId, assignmentId, responses, testHooks });
  }
  if (testHooks.failAfter === 'claim') {
    const err = new Error('TEST_INJECT_FAIL_AFTER_CLAIM');
    err.testInjected = true;
    throw err;
  }
  return finishSubmission(claimed, responses, ownerToken, testHooks);
}

async function finishSubmission(assignment, responses, ownerToken, testHooks) {
  const gradedResult = gradeAssignment(assignment, responses);
  if (gradedResult.error) {
    // Validation failure after claim — release to assigned only if no effects started
    await QuizAssignment.updateOne(
      {
        _id: assignment._id,
        submissionOwnerToken: ownerToken,
        'effectsApplied.attempts': { $ne: true },
      },
      {
        $set: {
          status: 'assigned',
          submissionLeaseUntil: null,
          submissionOwnerToken: null,
          pendingResponses: null,
          pendingFingerprint: null,
        },
      }
    );
    return { status: gradedResult.status || 400, body: gradedResult };
  }
  const { graded, total, maxTotal } = gradedResult;

  // Extend lease while working
  await QuizAssignment.updateOne(
    { _id: assignment._id, submissionOwnerToken: ownerToken },
    { $set: { submissionLeaseUntil: new Date(Date.now() + LEASE_MS) } }
  );

  const applied = await applyEffects(
    assignment,
    graded,
    total,
    maxTotal,
    ownerToken,
    testHooks
  );
  if (!applied.ok) {
    return {
      status: 409,
      body: { error: applied.error || 'lease_lost', assignmentId: assignment.assignmentId },
    };
  }

  const done = applied.assignment;
  const prog = applied.progress;
  const body = {
    assignmentId: done.assignmentId,
    status: 'submitted',
    score: done.score,
    maxMarks: done.maxMarks,
    observed_topic_performance: {
      [done.topicId]: {
        meanScore: prog.authenticMean,
        nAttempts: prog.authentic.length,
        nAuthenticAttempts: prog.authentic.length,
        nFixtureAttempts: prog.fixtures.length,
        authenticOnly: !done.isTestFixture,
      },
    },
    observed_topic_performance_fixture: done.isTestFixture
      ? {
          [done.topicId]: {
            meanScore: prog.fixtures.length
              ? prog.fixtures.reduce((s, a) => s + (a.score || 0), 0) / prog.fixtures.length
              : null,
            nAttempts: prog.fixtures.length,
          },
        }
      : {},
    estimated_mastery: null,
    curriculumVersion: done.curriculumVersion,
    catalogueMode: 'canonical',
    isTestFixture: done.isTestFixture,
    note: done.isTestFixture
      ? 'FIXTURE observed scores — excluded from authentic research aggregates'
      : 'Observed scores from frozen assignment — not validated cognitive mastery',
  };
  injectFail('complete', testHooks);
  return { status: 201, body };
}

/** Recover expired submitting leases by completing from pendingResponses. */
async function recoverStuckSubmissions({ limit = 50 } = {}) {
  const now = new Date();
  const stuck = await QuizAssignment.find({
    status: 'submitting',
    $or: [{ submissionLeaseUntil: null }, { submissionLeaseUntil: { $lte: now } }],
  }).limit(limit);
  const results = [];
  for (const row of stuck) {
    if (!row.pendingResponses || !row.pendingFingerprint) {
      results.push({
        assignmentId: row.assignmentId,
        status: 'skipped_no_pending_payload',
      });
      continue;
    }
    const out = await submitCanonicalAssignment({
      studentId: row.studentId,
      assignmentId: row.assignmentId,
      responses: row.pendingResponses,
    });
    results.push({
      assignmentId: row.assignmentId,
      httpStatus: out.status,
      error: out.body?.error || null,
      score: out.body?.score,
    });
  }
  return { n: results.length, results };
}

module.exports = {
  fingerprintResponses,
  submitCanonicalAssignment,
  recoverStuckSubmissions,
  rebuildProgress,
  syncObservedTwinFromAttempts,
  commitTwinRevision,
  setTwinCommitHook,
  LEASE_MS,
};
