/**
 * Durable submission recovery with failure injection (isolated Mongo).
 * Entire suite is synthetic testing — not research evidence.
 */
process.env.NODE_ENV = 'test';
process.env.ARTS_AI_ALLOW_TEST_FIXTURES = 'true';
process.env.ARTS_AI_SUBMIT_LEASE_MS = '500';
process.env.JWT_SECRET = 'test_jwt_recovery';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');

let mongoose;
let app;
let mem;
let basePort;
let server;
let QuizAssignment;
let QuizAttempt;
let Notification;

function clearCaches() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}src${path.sep}`)) delete require.cache[key];
  }
}

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: basePort,
        path: urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed = raw;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            /* */
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function seed() {
  const User = require('../src/models/User');
  const bcrypt = require('bcryptjs');
  await User.deleteMany({});
  await User.create({
    username: 'stu',
    role: 'student',
    displayName: 'S',
    studentId: 'syn_s0000',
    passwordHash: await bcrypt.hash('pw', 4),
    isSyntheticFixture: true,
  });
  await User.create({
    username: 'tea',
    role: 'teacher',
    displayName: 'T',
    teacherId: 'syn_t000',
    passwordHash: await bcrypt.hash('pw', 4),
    isSyntheticFixture: true,
  });
}

async function importAndApprove() {
  const tea = await request('POST', '/auth/login', { username: 'tea', password: 'pw' });
  const batch = {
    dryRun: false,
    questions: [1, 2, 3].map((i) => ({
      questionId: `rec_q${i}`,
      version: '1',
      curriculumVersion: 'nie_al_arts_provisional_v0.1',
      subjectId: 'sub_history',
      topicId: 'hist_sl_rajarata_politics',
      language: 'en',
      grade: '12',
      questionType: 'mcq',
      prompt: `Recovery Q${i}`,
      options: ['A', 'B'],
      correctAnswerOrRubric: 'A',
      sourceReference: `fixture://rec/${i}`,
      provenance: 'machine_authored_test_fixture_not_past_paper',
      permissionStatus: 'test_fixture_internal_use_only',
      mappingStatus: 'canonical_direct',
      reviewStatus: 'draft',
      isTestFixture: true,
    })),
    resources: [],
  };
  await request('POST', '/catalogue/import?dryRun=false', batch, tea.body.token);
  for (const i of [1, 2, 3]) {
    await request(
      'POST',
      `/catalogue/questions/rec_q${i}/versions/1/review`,
      {
        decision: 'approved_for_learner',
        reviewEvidence: 'TEST_FIXTURE_RECOVERY',
      },
      tea.body.token
    );
  }
  return tea.body.token;
}

before(async () => {
  clearCaches();
  const express = require('express');
  app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/auth', require('../src/routes/auth'));
  app.use('/learning', require('../src/routes/learning'));
  app.use('/catalogue', require('../src/routes/catalogue'));
  mongoose = require('mongoose');
  const { MongoMemoryServer } = require('mongodb-memory-server');
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri());
  await seed();
  QuizAssignment = require('../src/models/Catalogue').QuizAssignment;
  QuizAttempt = require('../src/models/LearningRecords').QuizAttempt;
  Notification = require('../src/models/PeerGroup').Notification;
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  basePort = server.address().port;
  await importAndApprove();
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (mongoose?.connection) await mongoose.disconnect();
  if (mem) await mem.stop();
});

describe('Quiz submission recovery', () => {
  it('recovers after fail-after-claim via retry', async () => {
    const stu = await request('POST', '/auth/login', { username: 'stu', password: 'pw' });
    const assign = await request(
      'POST',
      '/learning/quiz/syn_s0000/assign',
      {
        catalogueMode: 'canonical',
        subjectId: 'sub_history',
        topicId: 'hist_sl_rajarata_politics',
        language: 'en',
        nQuestions: 3,
        allowTestFixtures: true,
      },
      stu.body.token
    );
    assert.equal(assign.status, 201);
    const responses = assign.body.questions.map((q) => ({
      questionId: q.questionId,
      response: 'A',
    }));
    const fail = await request(
      'POST',
      `/learning/quiz/syn_s0000/assignments/${assign.body.assignmentId}/submit`,
      { responses, __testFailAfter: 'claim' },
      stu.body.token
    );
    assert.equal(fail.status, 500);
    const row = await QuizAssignment.findOne({ assignmentId: assign.body.assignmentId });
    assert.equal(row.status, 'submitting');
    assert.ok(row.pendingFingerprint);

    // Expire lease
    await QuizAssignment.updateOne(
      { assignmentId: assign.body.assignmentId },
      { $set: { submissionLeaseUntil: new Date(Date.now() - 1000) } }
    );
    const ok = await request(
      'POST',
      `/learning/quiz/syn_s0000/assignments/${assign.body.assignmentId}/submit`,
      { responses },
      stu.body.token
    );
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.score, 3);
    const attempts = await QuizAttempt.countDocuments({
      assignmentId: assign.body.assignmentId,
    });
    assert.equal(attempts, 3);
  });

  it('recovers after partial attempts via staff recovery', async () => {
    const stu = await request('POST', '/auth/login', { username: 'stu', password: 'pw' });
    const tea = await request('POST', '/auth/login', { username: 'tea', password: 'pw' });
    const assign = await request(
      'POST',
      '/learning/quiz/syn_s0000/assign',
      {
        catalogueMode: 'canonical',
        subjectId: 'sub_history',
        topicId: 'hist_sl_rajarata_politics',
        language: 'en',
        nQuestions: 3,
        allowTestFixtures: true,
      },
      stu.body.token
    );
    const responses = assign.body.questions.map((q) => ({
      questionId: q.questionId,
      response: 'A',
    }));
    const fail = await request(
      'POST',
      `/learning/quiz/syn_s0000/assignments/${assign.body.assignmentId}/submit`,
      { responses, __testFailAfter: 'attempts' },
      stu.body.token
    );
    assert.equal(fail.status, 500);
    await QuizAssignment.updateOne(
      { assignmentId: assign.body.assignmentId },
      { $set: { submissionLeaseUntil: new Date(Date.now() - 1000) } }
    );
    const rec = await request(
      'POST',
      '/learning/quiz/recover-stuck-submissions',
      { limit: 10 },
      tea.body.token
    );
    assert.equal(rec.status, 200);
    assert.ok(rec.body.results.some((r) => r.assignmentId === assign.body.assignmentId));
    const row = await QuizAssignment.findOne({ assignmentId: assign.body.assignmentId });
    assert.equal(row.status, 'submitted');
    assert.equal(row.score, 3);
    const ntf = await Notification.countDocuments({
      userId: 'syn_s0000',
      type: 'canonical_quiz_submitted',
      'payload.assignmentId': assign.body.assignmentId,
    });
    assert.equal(ntf, 1);
  });

  it('changed payload after accepted claim conflicts', async () => {
    const stu = await request('POST', '/auth/login', { username: 'stu', password: 'pw' });
    const assign = await request(
      'POST',
      '/learning/quiz/syn_s0000/assign',
      {
        catalogueMode: 'canonical',
        subjectId: 'sub_history',
        topicId: 'hist_sl_rajarata_politics',
        language: 'en',
        nQuestions: 3,
        allowTestFixtures: true,
      },
      stu.body.token
    );
    const responses = assign.body.questions.map((q) => ({
      questionId: q.questionId,
      response: 'A',
    }));
    await request(
      'POST',
      `/learning/quiz/syn_s0000/assignments/${assign.body.assignmentId}/submit`,
      { responses, __testFailAfter: 'claim' },
      stu.body.token
    );
    await QuizAssignment.updateOne(
      { assignmentId: assign.body.assignmentId },
      { $set: { submissionLeaseUntil: new Date(Date.now() - 1000) } }
    );
    const bad = responses.map((r, i) => (i === 0 ? { ...r, response: 'B' } : r));
    const conflict = await request(
      'POST',
      `/learning/quiz/syn_s0000/assignments/${assign.body.assignmentId}/submit`,
      { responses: bad },
      stu.body.token
    );
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, 'submission_payload_conflict');
  });

  it('concurrent retries produce one submitted result', async () => {
    const stu = await request('POST', '/auth/login', { username: 'stu', password: 'pw' });
    const assign = await request(
      'POST',
      '/learning/quiz/syn_s0000/assign',
      {
        catalogueMode: 'canonical',
        subjectId: 'sub_history',
        topicId: 'hist_sl_rajarata_politics',
        language: 'en',
        nQuestions: 3,
        allowTestFixtures: true,
      },
      stu.body.token
    );
    const responses = assign.body.questions.map((q) => ({
      questionId: q.questionId,
      response: 'A',
    }));
    const [a, b] = await Promise.all([
      request(
        'POST',
        `/learning/quiz/syn_s0000/assignments/${assign.body.assignmentId}/submit`,
        { responses },
        stu.body.token
      ),
      request(
        'POST',
        `/learning/quiz/syn_s0000/assignments/${assign.body.assignmentId}/submit`,
        { responses },
        stu.body.token
      ),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.ok(statuses.includes(201));
    assert.ok(statuses.includes(409));
    const attempts = await QuizAttempt.countDocuments({
      assignmentId: assign.body.assignmentId,
    });
    assert.equal(attempts, 3);
    const ntf = await Notification.countDocuments({
      type: 'canonical_quiz_submitted',
      'payload.assignmentId': assign.body.assignmentId,
    });
    assert.equal(ntf, 1);
  });
});
