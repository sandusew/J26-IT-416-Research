/**
 * Fixture attempts must not alter authentic Twin/progress/recommendation inputs.
 * Synthetic testing only.
 */
process.env.NODE_ENV = 'test';
process.env.ARTS_AI_ALLOW_TEST_FIXTURES = 'true';
process.env.JWT_SECRET = 'test_jwt_derived';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');

let mongoose;
let mem;
let basePort;
let server;
let QuizAttempt;

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

before(async () => {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}src${path.sep}`)) delete require.cache[key];
  }
  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/auth', require('../src/routes/auth'));
  app.use('/learning', require('../src/routes/learning'));
  app.use('/catalogue', require('../src/routes/catalogue'));
  mongoose = require('mongoose');
  const { MongoMemoryServer } = require('mongodb-memory-server');
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri());
  const User = require('../src/models/User');
  const bcrypt = require('bcryptjs');
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
  QuizAttempt = require('../src/models/LearningRecords').QuizAttempt;
  // Authentic-labelled synthetic attempt (isTestFixture=false) — still a test DB record
  await QuizAttempt.create({
    attemptId: 'att_auth_synth_1',
    studentId: 'syn_s0000',
    questionId: 'auth_synth_q1',
    topicId: 'hist_sl_rajarata_politics',
    response: 'A',
    score: 1,
    maxMarks: 1,
    gradingMethod: 'auto',
    dataOrigin: 'synthetic_authentic_labelled_test_db',
    isTestFixture: false,
  });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  basePort = server.address().port;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (mongoose?.connection) await mongoose.disconnect();
  if (mem) await mem.stop();
});

describe('Fixture vs authentic derived state', () => {
  it('fixture attempts do not change authentic Twin aggregates', async () => {
    const stu = await request('POST', '/auth/login', { username: 'stu', password: 'pw' });
    const tea = await request('POST', '/auth/login', { username: 'tea', password: 'pw' });

    const twin1 = await request(
      'POST',
      '/learning/digital-twin/syn_s0000/update',
      {
        events: [{ type: 'quiz', timestamp: new Date().toISOString() }],
        topic_performance: { hist_sl_rajarata_politics: { meanScore: 0.99, nAttempts: 99 } },
      },
      stu.body.token
    );
    assert.equal(twin1.status, 201);
    const authBefore = twin1.body.payload.observed_topic_performance.hist_sl_rajarata_politics;
    assert.equal(authBefore.nAttempts, 1);
    assert.equal(authBefore.meanScore, 1);
    // Client override ignored for authentic field
    assert.notEqual(authBefore.nAttempts, 99);

    // Import+approve+submit fixture quiz
    const batch = {
      dryRun: false,
      questions: [
        {
          questionId: 'fix_only_q1',
          version: '1',
          curriculumVersion: 'nie_al_arts_provisional_v0.1',
          subjectId: 'sub_history',
          topicId: 'hist_sl_rajarata_politics',
          language: 'en',
          questionType: 'mcq',
          prompt: 'Fixture only',
          options: ['A', 'B'],
          correctAnswerOrRubric: 'A',
          sourceReference: 'fixture://only',
          provenance: 'machine_authored_test_fixture_not_past_paper',
          permissionStatus: 'test_fixture_internal_use_only',
          mappingStatus: 'canonical_direct',
          reviewStatus: 'draft',
          isTestFixture: true,
        },
      ],
      resources: [
        {
          resourceId: 'fix_res_1',
          version: '1',
          curriculumVersion: 'nie_al_arts_provisional_v0.1',
          subjectId: 'sub_history',
          topicIds: ['hist_sl_rajarata_politics'],
          language: 'en',
          resourceType: 'reading',
          title: 'Fixture resource',
          sourceDocumentIdOrUrl: 'https://example.invalid/fixture',
          permissionStatus: 'test_fixture_internal_use_only',
          mappingStatus: 'canonical_direct',
          reviewStatus: 'draft',
          isTestFixture: true,
        },
      ],
    };
    await request('POST', '/catalogue/import?dryRun=false', batch, tea.body.token);
    await request(
      'POST',
      '/catalogue/questions/fix_only_q1/versions/1/review',
      {
        decision: 'approved_for_learner',
        reviewEvidence: 'TEST_FIXTURE',
      },
      tea.body.token
    );
    await request(
      'POST',
      '/catalogue/resources/fix_res_1/versions/1/review',
      {
        decision: 'approved_for_learner',
        reviewEvidence: 'TEST_FIXTURE',
      },
      tea.body.token
    );

    const assign = await request(
      'POST',
      '/learning/quiz/syn_s0000/assign',
      {
        catalogueMode: 'canonical',
        subjectId: 'sub_history',
        topicId: 'hist_sl_rajarata_politics',
        language: 'en',
        nQuestions: 1,
        allowTestFixtures: true,
      },
      stu.body.token
    );
    assert.equal(assign.status, 201);
    await request(
      'POST',
      `/learning/quiz/syn_s0000/assignments/${assign.body.assignmentId}/submit`,
      { responses: [{ questionId: 'fix_only_q1', response: 'A' }] },
      stu.body.token
    );

    const twin2 = await request(
      'POST',
      '/learning/digital-twin/syn_s0000/update',
      { events: [] },
      stu.body.token
    );
    const authAfter = twin2.body.payload.observed_topic_performance.hist_sl_rajarata_politics;
    assert.equal(authAfter.nAttempts, 1);
    assert.equal(authAfter.meanScore, 1);
    assert.ok(twin2.body.payload.observed_topic_performance_fixture.hist_sl_rajarata_politics);
    assert.equal(
      twin2.body.payload.observed_topic_performance_fixture.hist_sl_rajarata_politics.nAttempts,
      1
    );

    const prog = await request('GET', '/learning/progress/syn_s0000', null, stu.body.token);
    assert.equal(prog.body.nAuthenticQuizAttempts, 1);
    assert.ok(prog.body.nFixtureQuizAttempts >= 1);

    // Without fixture flag, recommendations must not use fixture-only practice for unlock
    // and must not include fixture resources
    const rec = await request(
      'GET',
      '/learning/recommendations/syn_s0000?catalogueMode=canonical&subjectId=sub_history',
      null,
      stu.body.token
    );
    assert.equal(rec.status, 200);
    assert.ok(!(rec.body.recommendations || []).some((r) => r.isTestFixture));
  });
});
