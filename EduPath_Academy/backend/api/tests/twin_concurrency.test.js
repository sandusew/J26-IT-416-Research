/**
 * Deterministic Twin concurrency. Isolated memory Mongo. Not research evidence.
 * The pause is a promise gate inside the writer, not a sleep.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_twin_concurrency';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');

let mongoose;
let mem;
let QuizAssignment;
let QuizAttempt;
let DigitalTwinProfile;
let TwinHead;
let ProgressSnapshot;
let Notification;
let quiz;

function armPause(studentId) {
  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  let markEntered;
  const entered = new Promise((resolve) => {
    markEntered = resolve;
  });
  let armed = true;
  quiz.setTwinCommitHook(async (info) => {
    if (!armed || info.studentId !== studentId || info.phase !== 'before_cas') return;
    if (info.evidenceCount !== 1) return;
    armed = false;
    markEntered();
    await gate;
  });
  return {
    entered,
    release() {
      releaseGate();
    },
  };
}

async function makeAssignment({ assignmentId, studentId, topicId, questionId, fixture = false }) {
  await QuizAssignment.create({
    assignmentId,
    studentId,
    curriculumVersion: 'nie_al_arts_provisional_v0.1',
    subjectId: 'sub_history',
    topicId,
    language: 'en',
    isTestFixture: fixture,
    dataOrigin: fixture ? 'test_fixture' : 'synthetic_learner',
    maxMarks: 1,
    questions: [
      {
        questionId,
        questionType: 'mcq',
        options: ['yes', 'no'],
        correctAnswerOrRubric: 'yes',
        maxMarks: 1,
      },
    ],
  });
}

function submit(studentId, assignmentId, response = 'yes') {
  return quiz.submitCanonicalAssignment({
    studentId,
    assignmentId,
    responses: [{ questionId: `${assignmentId}_q`, response }],
  });
}

before(async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  mem = await MongoMemoryServer.create();
  mongoose = require('mongoose');
  await mongoose.connect(mem.getUri('arts_ai_twin_concurrency'));
  quiz = require('../src/services/quizSubmission');
  QuizAssignment = require('../src/models/Catalogue').QuizAssignment;
  QuizAttempt = require('../src/models/LearningRecords').QuizAttempt;
  ProgressSnapshot = require('../src/models/LearningRecords').ProgressSnapshot;
  DigitalTwinProfile = require('../src/models/DigitalTwinProfile');
  TwinHead = DigitalTwinProfile.TwinHead;
  Notification = require('../src/models/PeerGroup').Notification;
});

after(async () => {
  if (quiz) quiz.setTwinCommitHook(null);
  if (mongoose?.connection?.readyState) await mongoose.disconnect();
  if (mem) await mem.stop();
});

afterEach(() => {
  quiz.setTwinCommitHook(null);
});

describe('twin compare-and-set', () => {
  it('scenario A: a paused older aggregate cannot overwrite a newer twin', async () => {
    const studentId = 'race_a';
    await makeAssignment({
      assignmentId: 'asg_a',
      studentId,
      topicId: 'topic_a',
      questionId: 'asg_a_q',
    });
    await makeAssignment({
      assignmentId: 'asg_b',
      studentId,
      topicId: 'topic_b',
      questionId: 'asg_b_q',
    });
    const pause = armPause(studentId);
    const pendingA = submit(studentId, 'asg_a');
    await Promise.race([
      pause.entered,
      new Promise((_, reject) => setTimeout(() => reject(new Error('writer A did not reach the barrier')), 8000)),
    ]);
    const resultB = await submit(studentId, 'asg_b');
    assert.equal(resultB.status, 201);
    pause.release();
    const resultA = await pendingA;
    assert.equal(resultA.status, 201);

    const latest = await DigitalTwinProfile.findOne({ studentId }).sort({ profileVersion: -1 }).lean();
    const observed = latest.payload.observed_topic_performance;
    assert.equal(observed.topic_a.nAttempts, 1);
    assert.equal(observed.topic_b.nAttempts, 1);
    assert.equal(observed.topic_a.meanScore, 1);
    assert.equal(observed.topic_b.meanScore, 1);
    assert.equal(latest.payload.evidence_count, 2);

    const versions = await DigitalTwinProfile.find({ studentId }).sort({ profileVersion: 1 }).lean();
    const newest = versions[versions.length - 1];
    assert.equal(newest.profileVersion, latest.profileVersion);
    assert.ok(newest.payload.observed_topic_performance.topic_b);

    const [assignmentA, assignmentB] = await Promise.all([
      QuizAssignment.findOne({ assignmentId: 'asg_a' }).lean(),
      QuizAssignment.findOne({ assignmentId: 'asg_b' }).lean(),
    ]);
    assert.equal(assignmentA.status, 'submitted');
    assert.equal(assignmentB.status, 'submitted');
    assert.equal(assignmentA.effectsApplied.twin, true);
    assert.equal(assignmentB.effectsApplied.twin, true);
    assert.equal(await QuizAttempt.countDocuments({ studentId, isTestFixture: false }), 2);

    const progressA = await ProgressSnapshot.findOne({ studentId, topicId: 'topic_a' }).lean();
    const progressB = await ProgressSnapshot.findOne({ studentId, topicId: 'topic_b' }).lean();
    assert.equal(progressA.nAuthenticAttempts, 1);
    assert.equal(progressB.nAuthenticAttempts, 1);
  });

  it('scenario B: concurrent distinct assignments both land and keep unrelated fields', async () => {
    const studentId = 'race_b';
    await TwinHead.create({ studentId, revision: 1 });
    await DigitalTwinProfile.create({
      studentId,
      profileVersion: 1,
      dataCategory: 'synthetic_learner',
      payload: {
        cohort_label: 'keep-me',
        observed_topic_performance: {},
        evidence_count: 0,
      },
    });
    await makeAssignment({
      assignmentId: 'asg_b1',
      studentId,
      topicId: 'topic_b1',
      questionId: 'asg_b1_q',
    });
    await makeAssignment({
      assignmentId: 'asg_b2',
      studentId,
      topicId: 'topic_b2',
      questionId: 'asg_b2_q',
    });
    const [first, second] = await Promise.all([
      quiz.submitCanonicalAssignment({
        studentId,
        assignmentId: 'asg_b1',
        responses: [{ questionId: 'asg_b1_q', response: 'yes' }],
      }),
      quiz.submitCanonicalAssignment({
        studentId,
        assignmentId: 'asg_b2',
        responses: [{ questionId: 'asg_b2_q', response: 'no' }],
      }),
    ]);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const latest = await DigitalTwinProfile.findOne({ studentId }).sort({ profileVersion: -1 }).lean();
    assert.equal(latest.payload.cohort_label, 'keep-me');
    assert.equal(latest.payload.evidence_count, 2);
    assert.equal(latest.payload.observed_topic_performance.topic_b1.nAttempts, 1);
    assert.equal(latest.payload.observed_topic_performance.topic_b1.meanScore, 1);
    assert.equal(latest.payload.observed_topic_performance.topic_b2.nAttempts, 1);
    assert.equal(latest.payload.observed_topic_performance.topic_b2.meanScore, 0);
    assert.equal(await QuizAttempt.countDocuments({ studentId }), 2);
  });

  it('scenario C: retries, crashes, and fixtures do not double-count', async () => {
    const studentId = 'race_c';
    await makeAssignment({
      assignmentId: 'asg_c',
      studentId,
      topicId: 'topic_c',
      questionId: 'asg_c_q',
    });
    const first = await submit(studentId, 'asg_c');
    assert.equal(first.status, 201);
    const duplicate = await submit(studentId, 'asg_c');
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error, 'already_submitted');
    assert.equal(await QuizAttempt.countDocuments({ assignmentId: 'asg_c' }), 1);
    assert.equal(await Notification.countDocuments({ userId: studentId, type: 'canonical_quiz_submitted' }), 1);

    await makeAssignment({
      assignmentId: 'asg_c_attempts',
      studentId,
      topicId: 'topic_c2',
      questionId: 'asg_c_attempts_q',
    });
    await assert.rejects(
      () =>
        quiz.submitCanonicalAssignment({
          studentId,
          assignmentId: 'asg_c_attempts',
          responses: [{ questionId: 'asg_c_attempts_q', response: 'yes' }],
          testHooks: { failAfter: 'attempts' },
        }),
      (err) => err && err.testInjected === true
    );
    let stuck = await QuizAssignment.findOne({ assignmentId: 'asg_c_attempts' }).lean();
    assert.equal(stuck.status, 'submitting');
    assert.equal(stuck.effectsApplied.attempts, true);
    assert.equal(stuck.effectsApplied.twin, false);
    await QuizAssignment.updateOne(
      { assignmentId: 'asg_c_attempts' },
      { $set: { submissionLeaseUntil: new Date(0) } }
    );
    const recoveredAttempts = await quiz.recoverStuckSubmissions();
    assert.equal(recoveredAttempts.results[0].httpStatus, 201);
    assert.equal(await QuizAttempt.countDocuments({ assignmentId: 'asg_c_attempts' }), 1);

    await makeAssignment({
      assignmentId: 'asg_c_twin',
      studentId,
      topicId: 'topic_c3',
      questionId: 'asg_c_twin_q',
    });
    const beforeTwinProfiles = await DigitalTwinProfile.countDocuments({ studentId });
    await assert.rejects(
      () =>
        quiz.submitCanonicalAssignment({
          studentId,
          assignmentId: 'asg_c_twin',
          responses: [{ questionId: 'asg_c_twin_q', response: 'yes' }],
          testHooks: { failAfter: 'twin_written' },
        }),
      (err) => err && err.testInjected === true
    );
    stuck = await QuizAssignment.findOne({ assignmentId: 'asg_c_twin' }).lean();
    assert.equal(stuck.effectsApplied.twin, false);
    assert.equal(stuck.status, 'submitting');
    assert.ok((await DigitalTwinProfile.countDocuments({ studentId })) > beforeTwinProfiles);
    const attemptsBeforeRecovery = await QuizAttempt.countDocuments({ studentId });
    await QuizAssignment.updateOne(
      { assignmentId: 'asg_c_twin' },
      { $set: { submissionLeaseUntil: new Date(0) } }
    );
    const recoveredTwin = await quiz.recoverStuckSubmissions();
    const twinRow = recoveredTwin.results.find((row) => row.assignmentId === 'asg_c_twin');
    assert.equal(twinRow.httpStatus, 201);
    assert.equal(await QuizAttempt.countDocuments({ studentId }), attemptsBeforeRecovery);
    assert.equal(
      await Notification.countDocuments({ notificationId: 'ntf_cq_asg_c_twin' }),
      1
    );
    const again = await submit(studentId, 'asg_c_twin');
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'already_submitted');
    const finished = await QuizAssignment.findOne({ assignmentId: 'asg_c_twin' }).lean();
    assert.equal(finished.effectsApplied.twin, true);

    await makeAssignment({
      assignmentId: 'asg_c_fix',
      studentId,
      topicId: 'topic_fixture',
      questionId: 'asg_c_fix_q',
      fixture: true,
    });
    const fixtureResult = await submit(studentId, 'asg_c_fix');
    assert.equal(fixtureResult.status, 201);
    const latest = await DigitalTwinProfile.findOne({ studentId }).sort({ profileVersion: -1 }).lean();
    assert.equal(latest.payload.observed_topic_performance.topic_fixture, undefined);
    assert.equal(latest.payload.observed_topic_performance_fixture.topic_fixture.nAttempts, 1);
    const authenticAttempts = await QuizAttempt.countDocuments({ studentId, isTestFixture: false });
    assert.equal(latest.payload.evidence_count, authenticAttempts);
  });

  it('the previous write order publishes a stale aggregate as the newest version', async () => {
    const studentId = 'old_pattern';
    await QuizAttempt.create({
      attemptId: 'att_old_a',
      assignmentId: 'old_a',
      studentId,
      questionId: 'q_old_a',
      topicId: 'topic_a',
      score: 1,
      maxMarks: 1,
      isTestFixture: false,
    });
    const staleCount = await QuizAttempt.countDocuments({ studentId });
    await QuizAttempt.create({
      attemptId: 'att_old_b',
      assignmentId: 'old_b',
      studentId,
      questionId: 'q_old_b',
      topicId: 'topic_b',
      score: 1,
      maxMarks: 1,
      isTestFixture: false,
    });
    await quiz.syncObservedTwinFromAttempts(studentId);
    const current = await DigitalTwinProfile.findOne({ studentId }).sort({ profileVersion: -1 }).lean();
    assert.equal(current.payload.observed_topic_performance.topic_b.nAttempts, 1);
    await DigitalTwinProfile.create({
      studentId,
      profileVersion: current.profileVersion + 1,
      dataCategory: 'synthetic_learner',
      payload: {
        evidence_count: staleCount,
        observed_topic_performance: { topic_a: { nAttempts: staleCount, meanScore: 1 } },
      },
    });
    const overwritten = await DigitalTwinProfile.findOne({ studentId }).sort({ profileVersion: -1 }).lean();
    assert.equal(overwritten.payload.observed_topic_performance.topic_b, undefined);
    assert.equal(overwritten.profileVersion, current.profileVersion + 1);
  });
});
