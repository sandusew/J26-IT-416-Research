/**
 * Canonical catalogue import, review, quiz assign/submit, recommendations.
 * Uses isolated Mongo + labelled TEST FIXTURES (not authentic teacher review).
 *
 * Fixtures require server ARTS_AI_ALLOW_TEST_FIXTURES=true (set here for this suite).
 */
process.env.NODE_ENV = 'test';
process.env.ARTS_AI_ALLOW_TEST_FIXTURES = 'true';
process.env.JWT_SECRET = 'test_jwt_secret_canonical';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');

let mongoose;
let app;
let hasMongo = false;
let mem = null;
let connectedUri = null;
let basePort = null;
let persistentServer = null;

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function clearConfigCache() {
  const cfgPath = require.resolve('../src/config');
  delete require.cache[cfgPath];
  const polPath = require.resolve('../src/services/fixturePolicy');
  delete require.cache[polPath];
  // Routes that closed over config — reload learning/catalogue
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}src${path.sep}routes${path.sep}learning`) ||
      key.includes(`${path.sep}src${path.sep}routes${path.sep}catalogue`) ||
      key.includes(`${path.sep}src${path.sep}services${path.sep}catalogueService`)
    ) {
      delete require.cache[key];
    }
  }
}

async function buildApp() {
  const express = require('express');
  app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/auth', require('../src/routes/auth'));
  app.use('/learning', require('../src/routes/learning'));
  app.use('/catalogue', require('../src/routes/catalogue'));
  app.use('/ml', require('../src/routes/ml'));
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
            /* keep string */
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

async function seedUsers() {
  const User = require('../src/models/User');
  const bcrypt = require('bcryptjs');
  await User.deleteMany({ username: { $in: ['stu', 'stu2', 'tea', 'admin'] } });
  const mk = async (u) =>
    User.create({ ...u, passwordHash: await bcrypt.hash('pw', 4), isSyntheticFixture: true });
  await mk({ username: 'stu', role: 'student', displayName: 'S', studentId: 'syn_s0000' });
  await mk({ username: 'stu2', role: 'student', displayName: 'S2', studentId: 'syn_s0001' });
  await mk({ username: 'tea', role: 'teacher', displayName: 'T', teacherId: 'syn_t000' });
  await mk({ username: 'admin', role: 'admin', displayName: 'A' });
}

function loadFixtureBatch() {
  const p = path.join(
    __dirname,
    '..',
    '..',
    'ml',
    'data',
    'curriculum',
    'review_packages',
    'hist_sl_rajarata_politics_v0',
    'fixture_import_batch.json'
  );
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

before(async () => {
  process.env.ARTS_AI_ALLOW_TEST_FIXTURES = 'true';
  process.env.NODE_ENV = 'test';
  clearConfigCache();
  await buildApp();
  mongoose = require('mongoose');
  const { MongoMemoryServer } = require('mongodb-memory-server');
  mem = await withTimeout(MongoMemoryServer.create(), 120000, 'MongoMemoryServer');
  connectedUri = mem.getUri();
  await mongoose.connect(connectedUri);
  hasMongo = true;
  await seedUsers();
  persistentServer = http.createServer(app);
  await new Promise((r) => persistentServer.listen(0, '127.0.0.1', r));
  basePort = persistentServer.address().port;
});

after(async () => {
  if (persistentServer) await new Promise((r) => persistentServer.close(r));
  if (mongoose?.connection) await mongoose.disconnect();
  if (mem) await mem.stop();
});

describe('Canonical catalogue workflow (fixture-labelled)', () => {
  it('rejects student import', async () => {
    if (!hasMongo) return;
    const login = await request('POST', '/auth/login', { username: 'stu', password: 'pw' });
    const r = await request('POST', '/catalogue/import', { questions: [] }, login.body.token);
    assert.equal(r.status, 403);
  });

  it('dry-run validates and rejects partial_match', async () => {
    const tea = await request('POST', '/auth/login', { username: 'tea', password: 'pw' });
    const batch = loadFixtureBatch();
    const r = await request('POST', '/catalogue/import', batch, tea.body.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.dryRun, true);
    assert.ok(r.body.nAccepted >= 3);
    assert.ok(
      r.body.rejected.some((x) =>
        (x.errors || []).includes('partial_match_not_accepted_as_verified_canonical')
      )
    );
  });

  it('rejects import that tries to approve without review endpoint', async () => {
    const tea = await request('POST', '/auth/login', { username: 'tea', password: 'pw' });
    const r = await request(
      'POST',
      '/catalogue/import',
      {
        dryRun: true,
        questions: [
          {
            questionId: 'canon_hist_rajarata_sneak_approve',
            version: '1',
            curriculumVersion: 'nie_al_arts_provisional_v0.1',
            subjectId: 'sub_history',
            topicId: 'hist_sl_rajarata_politics',
            language: 'en',
            questionType: 'mcq',
            prompt: 'Sneak',
            options: ['A', 'B'],
            correctAnswerOrRubric: 'A',
            sourceReference: 'fixture://x',
            provenance: 'machine_authored_test_fixture_not_past_paper',
            permissionStatus: 'test_fixture_internal_use_only',
            mappingStatus: 'canonical_direct',
            reviewStatus: 'approved_for_learner',
            reviewerId: 'forged_teacher',
            isTestFixture: true,
          },
        ],
      },
      tea.body.token
    );
    assert.equal(r.status, 200);
    assert.ok(
      r.body.rejected.some((x) =>
        (x.errors || []).includes('import_cannot_set_approved_for_learner_use_review_endpoint')
      )
    );
  });

  it('persists import idempotently and conflicts on hash change', async () => {
    const tea = await request('POST', '/auth/login', { username: 'tea', password: 'pw' });
    const batch = loadFixtureBatch();
    batch.questions = batch.questions.filter((q) => q.mappingStatus !== 'partial_match');
    batch.dryRun = false;
    const r1 = await request(
      'POST',
      '/catalogue/import?dryRun=false',
      { ...batch, dryRun: false },
      tea.body.token
    );
    assert.equal(r1.status, 201);
    assert.ok(r1.body.nAccepted >= 4);
    const r2 = await request(
      'POST',
      '/catalogue/import?dryRun=false',
      { ...batch, dryRun: false },
      tea.body.token
    );
    assert.equal(r2.status, 201);
    assert.ok(
      r2.body.accepted.every((a) => a.status === 'idempotent_unchanged' || a.status === 'accepted')
    );
    const changed = {
      dryRun: false,
      questions: [{ ...batch.questions[0], prompt: 'CHANGED PROMPT TRIGGERS CONFLICT' }],
      resources: [],
    };
    const r3 = await request('POST', '/catalogue/import?dryRun=false', changed, tea.body.token);
    assert.ok(r3.body.rejected.some((x) => String(x.status || '').includes('conflict')));
  });

  it('draft excluded from learner assign; empty bank structured unavailable', async () => {
    const stu = await request('POST', '/auth/login', { username: 'stu', password: 'pw' });
    const empty = await request(
      'POST',
      '/learning/quiz/syn_s0000/assign',
      {
        catalogueMode: 'canonical',
        curriculumVersion: 'nie_al_arts_provisional_v0.1',
        subjectId: 'sub_history',
        topicId: 'hist_sl_rajarata_politics',
        language: 'en',
        nQuestions: 3,
        allowTestFixtures: true,
      },
      stu.body.token
    );
    assert.equal(empty.status, 409);
    assert.equal(empty.body.error, 'canonical_question_bank_unavailable');
  });

  it('client allowTestFixtures alone is rejected when server policy disabled', async () => {
    process.env.ARTS_AI_ALLOW_TEST_FIXTURES = 'false';
    clearConfigCache();
    // Rebuild routes with new policy without restarting mongo
    const express = require('express');
    const fresh = express();
    fresh.use(express.json({ limit: '2mb' }));
    fresh.use('/auth', require('../src/routes/auth'));
    fresh.use('/learning', require('../src/routes/learning'));
    fresh.use('/catalogue', require('../src/routes/catalogue'));
    await new Promise((r) => persistentServer.close(r));
    persistentServer = http.createServer(fresh);
    await new Promise((r) => persistentServer.listen(0, '127.0.0.1', r));
    basePort = persistentServer.address().port;

    const stu = await request('POST', '/auth/login', { username: 'stu', password: 'pw' });
    const denied = await request(
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
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'fixtures_not_enabled');

    // Restore fixture-enabled server for remaining tests
    process.env.ARTS_AI_ALLOW_TEST_FIXTURES = 'true';
    clearConfigCache();
    await buildApp();
    await new Promise((r) => persistentServer.close(r));
    persistentServer = http.createServer(app);
    await new Promise((r) => persistentServer.listen(0, '127.0.0.1', r));
    basePort = persistentServer.address().port;
  });

  it('fixture approval labelled; assign/submit/progress/twin/recs path', async () => {
    const tea = await request('POST', '/auth/login', { username: 'tea', password: 'pw' });
    const stu = await request('POST', '/auth/login', { username: 'stu', password: 'pw' });
    for (const qid of ['canon_hist_rajarata_q01', 'canon_hist_rajarata_q02', 'canon_hist_rajarata_q03']) {
      const rev = await request(
        'POST',
        `/catalogue/questions/${qid}/versions/1/review`,
        {
          decision: 'approved_for_learner',
          reviewEvidence: 'TEST_FIXTURE_APPROVAL_BY_syn_t000_NOT_AUTHENTIC_TEACHER_REVIEW',
          reviewerId: 'forged_should_be_ignored',
        },
        tea.body.token
      );
      assert.equal(rev.status, 200);
      assert.equal(rev.body.isTestFixture, true);
      assert.equal(rev.body.reviewerId, 'syn_t000');
    }
    const resRev = await request(
      'POST',
      '/catalogue/resources/canon_hist_rajarata_r01/versions/1/review',
      {
        decision: 'approved_for_learner',
        reviewEvidence: 'TEST_FIXTURE_APPROVAL_BY_syn_t000_NOT_AUTHENTIC_TEACHER_REVIEW',
      },
      tea.body.token
    );
    assert.equal(resRev.status, 200);

    const meta = await request('GET', '/catalogue/meta', null, tea.body.token);
    assert.equal(meta.body.nApprovedNonFixtureQuestions, 0);
    assert.ok(meta.body.nApprovedFixtureQuestions >= 3);

    const assign = await request(
      'POST',
      '/learning/quiz/syn_s0000/assign',
      {
        catalogueMode: 'canonical',
        curriculumVersion: 'nie_al_arts_provisional_v0.1',
        subjectId: 'sub_history',
        topicId: 'hist_sl_rajarata_politics',
        language: 'en',
        nQuestions: 3,
        allowTestFixtures: true,
      },
      stu.body.token
    );
    assert.equal(assign.status, 201, JSON.stringify(assign.body));
    assert.equal(assign.body.answerKeysIncluded, false);
    assert.equal(assign.body.isTestFixture, true);
    for (const q of assign.body.questions) {
      assert.equal(q.correctAnswerOrRubric, undefined);
    }

    const stu2 = await request('POST', '/auth/login', { username: 'stu2', password: 'pw' });
    const forbidden = await request(
      'POST',
      `/learning/quiz/syn_s0001/assignments/${assign.body.assignmentId}/submit`,
      { responses: [] },
      stu2.body.token
    );
    assert.equal(forbidden.status, 404);

    const crossGet = await request(
      'GET',
      `/learning/quiz/syn_s0001/assignments/${assign.body.assignmentId}`,
      null,
      stu2.body.token
    );
    assert.equal(crossGet.status, 404);

    const responses = [
      { questionId: 'canon_hist_rajarata_q01', response: 'Anuradhapura' },
      { questionId: 'canon_hist_rajarata_q02', response: 'Rajarata succession after Anuradhapura' },
      { questionId: 'canon_hist_rajarata_q03', response: 'True' },
    ];
    const sub = await request(
      'POST',
      `/learning/quiz/syn_s0000/assignments/${assign.body.assignmentId}/submit`,
      { responses },
      stu.body.token
    );
    assert.equal(sub.status, 201);
    assert.equal(sub.body.score, 3);
    assert.equal(sub.body.isTestFixture, true);
    assert.equal(sub.body.estimated_mastery, null);

    const dup = await request(
      'POST',
      `/learning/quiz/syn_s0000/assignments/${assign.body.assignmentId}/submit`,
      { responses },
      stu.body.token
    );
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, 'already_submitted');

    const twin = await request(
      'POST',
      '/learning/digital-twin/syn_s0000/update',
      {
        events: [{ type: 'quiz', timestamp: new Date().toISOString() }],
        curriculum_version: 'nie_al_arts_provisional_v0.1',
        enrolled_subjects: ['sub_history'],
        topic_performance: sub.body.observed_topic_performance,
        data_category: 'test_fixture_learner',
      },
      stu.body.token
    );
    assert.equal(twin.status, 201, JSON.stringify(twin.body));

    const prog = await request('GET', '/learning/progress/syn_s0000', null, stu.body.token);
    assert.equal(prog.status, 200);
    assert.ok(prog.body.nFixtureQuizAttempts >= 3);
    assert.equal(prog.body.nAuthenticQuizAttempts, 0);

    const rec = await request(
      'GET',
      '/learning/recommendations/syn_s0000?catalogueMode=canonical&subjectId=sub_history&policyMode=trained_ranker&allowTestFixtures=true&curriculumVersion=nie_al_arts_provisional_v0.1',
      null,
      stu.body.token
    );
    assert.equal(rec.status, 200);
    assert.equal(rec.body.trainedScorerUsed, false);
    assert.ok(String(rec.body.fallbackReason).includes('incompatible_canonical'));
    assert.ok(rec.body.nEligible >= 1);

    await new Promise((resolve, reject) => {
      persistentServer.close((err) => (err ? reject(err) : resolve()));
    });
    await new Promise((r) => setTimeout(r, 200));
    persistentServer = http.createServer(app);
    await new Promise((resolve, reject) => {
      persistentServer.once('error', reject);
      persistentServer.listen(0, '127.0.0.1', () => {
        basePort = persistentServer.address().port;
        resolve();
      });
    });
    const prog2 = await request('GET', '/learning/progress/syn_s0000', null, stu.body.token);
    assert.ok(prog2.body.nFixtureQuizAttempts >= 3);
  });

  it('frozen scoring survives subsequent catalogue answer edit', async () => {
    const tea = await request('POST', '/auth/login', { username: 'tea', password: 'pw' });
    const stu = await request('POST', '/auth/login', { username: 'stu', password: 'pw' });
    // Ensure q01 approved (may already be pending after edit in other runs — re-approve)
    await request(
      'POST',
      '/catalogue/questions/canon_hist_rajarata_q01/versions/1/review',
      {
        decision: 'approved_for_learner',
        reviewEvidence: 'TEST_FIXTURE_APPROVAL_FOR_FROZEN_SCORE',
      },
      tea.body.token
    );
    await request(
      'POST',
      '/catalogue/questions/canon_hist_rajarata_q02/versions/1/review',
      {
        decision: 'approved_for_learner',
        reviewEvidence: 'TEST_FIXTURE_APPROVAL_FOR_FROZEN_SCORE',
      },
      tea.body.token
    );
    await request(
      'POST',
      '/catalogue/questions/canon_hist_rajarata_q03/versions/1/review',
      {
        decision: 'approved_for_learner',
        reviewEvidence: 'TEST_FIXTURE_APPROVAL_FOR_FROZEN_SCORE',
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
        nQuestions: 3,
        allowTestFixtures: true,
      },
      stu.body.token
    );
    assert.equal(assign.status, 201, JSON.stringify(assign.body));

    // Edit approved key after assign — must reopen review and not change frozen score
    const patch = await request(
      'PATCH',
      '/catalogue/questions/canon_hist_rajarata_q01/versions/1',
      { correctAnswerOrRubric: 'WRONG_NEW_KEY_SHOULD_NOT_AFFECT_FROZEN' },
      tea.body.token
    );
    assert.equal(patch.status, 200);
    assert.equal(patch.body.reReviewRequired, true);
    assert.equal(patch.body.question.reviewStatus, 'pending_review');

    const sub = await request(
      'POST',
      `/learning/quiz/syn_s0000/assignments/${assign.body.assignmentId}/submit`,
      {
        responses: [
          { questionId: 'canon_hist_rajarata_q01', response: 'Anuradhapura' },
          {
            questionId: 'canon_hist_rajarata_q02',
            response: 'Rajarata succession after Anuradhapura',
          },
          { questionId: 'canon_hist_rajarata_q03', response: 'True' },
        ],
      },
      stu.body.token
    );
    assert.equal(sub.status, 201);
    assert.equal(sub.body.score, 3);
  });

  it('concurrent submissions yield one result', async () => {
    const tea = await request('POST', '/auth/login', { username: 'tea', password: 'pw' });
    const stu = await request('POST', '/auth/login', { username: 'stu', password: 'pw' });
    // Retire corrupted v1; use clean v2 + q02/q03
    await request(
      'POST',
      '/catalogue/questions/canon_hist_rajarata_q01/versions/1/review',
      { decision: 'retired', reviewEvidence: 'TEST_RETIRE_CORRUPTED_V1' },
      tea.body.token
    );
    const newQ = {
      dryRun: false,
      questions: [
        {
          questionId: 'canon_hist_rajarata_q01',
          version: '2',
          curriculumVersion: 'nie_al_arts_provisional_v0.1',
          subjectId: 'sub_history',
          topicId: 'hist_sl_rajarata_politics',
          language: 'en',
          grade: '12',
          questionType: 'mcq',
          prompt: 'Which ancient city was a capital of the Rajarata civilization in Sri Lanka?',
          options: ['Anuradhapura', 'Kandy', 'Galle', 'Jaffna'],
          correctAnswerOrRubric: 'Anuradhapura',
          sourceReference: 'fixture://hist_sl_rajarata_politics/q01v2',
          provenance: 'machine_authored_test_fixture_not_past_paper',
          permissionStatus: 'test_fixture_internal_use_only',
          mappingStatus: 'canonical_direct',
          reviewStatus: 'draft',
          isTestFixture: true,
        },
      ],
      resources: [],
    };
    await request('POST', '/catalogue/import?dryRun=false', newQ, tea.body.token);
    for (const [qid, ver] of [
      ['canon_hist_rajarata_q01', '2'],
      ['canon_hist_rajarata_q02', '1'],
      ['canon_hist_rajarata_q03', '1'],
    ]) {
      await request(
        'POST',
        `/catalogue/questions/${qid}/versions/${ver}/review`,
        {
          decision: 'approved_for_learner',
          reviewEvidence: 'TEST_FIXTURE_APPROVAL_CONCURRENT',
        },
        tea.body.token
      );
    }

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
    assert.equal(assign.status, 201, JSON.stringify(assign.body));
    assert.equal(new Set(assign.body.questions.map((q) => q.questionId)).size, 3);
    const keyById = {
      canon_hist_rajarata_q01: 'Anuradhapura',
      canon_hist_rajarata_q02: 'Rajarata succession after Anuradhapura',
      canon_hist_rajarata_q03: 'True',
    };
    const responses = assign.body.questions.map((q) => ({
      questionId: q.questionId,
      response: keyById[q.questionId],
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
    assert.deepEqual(statuses, [201, 409]);
    const ok = a.status === 201 ? a : b;
    assert.equal(ok.body.score, 3);

    const QuizAttempt = require('../src/models/LearningRecords').QuizAttempt;
    const n = await QuizAttempt.countDocuments({ assignmentId: assign.body.assignmentId });
    assert.equal(n, 3);
  });

  it('editing approved question forces re-review', async () => {
    const tea = await request('POST', '/auth/login', { username: 'tea', password: 'pw' });
    const patch = await request(
      'PATCH',
      '/catalogue/questions/canon_hist_rajarata_q02/versions/1',
      { prompt: 'Edited approved prompt must reopen review' },
      tea.body.token
    );
    assert.equal(patch.status, 200);
    assert.equal(patch.body.reReviewRequired, true);
    assert.equal(patch.body.question.reviewStatus, 'pending_review');
  });

  it('authentic bank remains unavailable without fixtures when none approved', async () => {
    const stu = await request('POST', '/auth/login', { username: 'stu', password: 'pw' });
    const r = await request(
      'POST',
      '/learning/quiz/syn_s0000/assign',
      {
        catalogueMode: 'canonical',
        subjectId: 'sub_history',
        topicId: 'hist_sl_rajarata_politics',
        language: 'en',
        nQuestions: 1,
        // no allowTestFixtures
      },
      stu.body.token
    );
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'canonical_question_bank_unavailable');
    assert.equal(r.body.fixturesAllowed, false);
  });
});
