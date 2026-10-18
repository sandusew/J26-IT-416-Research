/**
 * AI-authored practice publication policy — synthetic isolated DB.
 * Does not claim teacher review or authentic institutional content.
 */
process.env.NODE_ENV = 'test';
process.env.ARTS_AI_ALLOW_TEST_FIXTURES = 'true';
process.env.ARTS_AI_CONTENT_POLICY = 'published_practice';
process.env.JWT_SECRET = 'test_jwt_practice_pub';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');

let mongoose;
let mem;
let basePort;
let server;

function clearConfigCache() {
  const cfgPath = require.resolve('../src/config');
  delete require.cache[cfgPath];
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}src${path.sep}routes${path.sep}`) ||
      key.includes(`${path.sep}src${path.sep}services${path.sep}`)
    ) {
      delete require.cache[key];
    }
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
            parsed = JSON.parse(raw);
          } catch {
            /* keep */
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
  await User.deleteMany({ username: { $in: ['stu', 'tea', 'admin'] } });
  const mk = async (u) =>
    User.create({ ...u, passwordHash: await bcrypt.hash('pw', 4), isSyntheticFixture: true });
  await mk({ username: 'stu', role: 'student', displayName: 'S', studentId: 'syn_s0000' });
  await mk({ username: 'tea', role: 'teacher', displayName: 'T', teacherId: 'syn_t000' });
  await mk({ username: 'admin', role: 'admin', displayName: 'A' });
}

const SAMPLE_Q = {
  questionId: 'prac_test_hist_q01',
  version: '1',
  curriculumVersion: 'nie_al_arts_provisional_v0.1',
  subjectId: 'sub_history',
  topicId: 'hist_sl_rajarata_politics',
  language: 'en',
  grade: '12',
  questionType: 'mcq',
  prompt: 'Practice publication test: Which city was a Rajarata capital?',
  options: ['Anuradhapura', 'Kandy', 'Galle', 'Jaffna'],
  correctAnswerOrRubric: 'Anuradhapura',
  explanation: 'Source-grounded AI practice item for policy tests.',
  maxMarks: 1,
  difficulty: 0.3,
  difficultyBasis: 'author_estimate',
  sourceReference: 'https://en.wikipedia.org/wiki/Anuradhapura',
  sourceIds: ['wiki_en_anuradhapura'],
  provenance: 'ai_authored_source_grounded_practice_not_past_paper',
  contentOrigin: 'ai_authored_source_grounded',
  permissionStatus: 'ai_authored_with_cc_by_sa_source_attribution',
  mappingStatus: 'canonical_direct',
  mappingConfidence: 'medium_inferred',
  reviewStatus: 'draft',
  humanReviewStatus: 'unreviewed',
  automatedValidation: 'passed',
  isTestFixture: false,
  dataOrigin: 'ai_authored_practice_bank_v1',
};

const SAMPLE_R = {
  resourceId: 'prac_test_hist_r01',
  version: '1',
  curriculumVersion: 'nie_al_arts_provisional_v0.1',
  subjectId: 'sub_history',
  topicIds: ['hist_sl_rajarata_politics'],
  language: 'en',
  grade: '12',
  resourceType: 'teaching_package',
  title: 'Rajarata practice package (test)',
  difficulty: 0.4,
  difficultyBasis: 'author_estimate',
  prerequisiteTopicIds: [],
  sourceDocumentIdOrUrl: 'https://en.wikipedia.org/wiki/Anuradhapura',
  availability: 'draft',
  permissionStatus: 'ai_authored_with_cc_by_sa_source_attribution',
  mappingStatus: 'canonical_direct',
  reviewStatus: 'draft',
  humanReviewStatus: 'unreviewed',
  automatedValidation: 'passed',
  contentOrigin: 'ai_authored_source_grounded',
  isTestFixture: false,
  provenance: 'ai_authored_source_grounded_teaching_package',
  bodyText: 'AI-authored practice package body for policy tests. Not teacher-reviewed.',
};

before(async () => {
  clearConfigCache();
  const { MongoMemoryServer } = require('mongodb-memory-server');
  mongoose = require('mongoose');
  mem = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mem.getUri('arts_ai_practice_pub_test');
  clearConfigCache();
  await mongoose.connect(process.env.MONGODB_URI);
  await seedUsers();
  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/auth', require('../src/routes/auth'));
  app.use('/learning', require('../src/routes/learning'));
  app.use('/catalogue', require('../src/routes/catalogue'));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  basePort = server.address().port;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (mongoose?.connection) await mongoose.disconnect();
  if (mem) await mem.stop();
});

describe('practice publication policy', () => {
  it('import cannot forge teacher approval', async () => {
    const tea = await request('POST', '/auth/login', { username: 'tea', password: 'pw' });
    const forged = {
      ...SAMPLE_Q,
      questionId: 'prac_test_forge_q01',
      reviewStatus: 'approved_for_learner',
      humanReviewStatus: 'teacher_approved',
    };
    const res = await request(
      'POST',
      '/catalogue/import',
      { questions: [forged], resources: [], dryRun: false, persist: true },
      tea.body.token
    );
    assert.equal(res.status, 201);
    assert.ok((res.body.rejected || []).some((r) => (r.errors || []).some((e) => String(e).includes('approved'))));
  });

  it('publish-practice does not set teacher approval; practice mode assigns', async () => {
    const tea = await request('POST', '/auth/login', { username: 'tea', password: 'pw' });
    const stu = await request('POST', '/auth/login', { username: 'stu', password: 'pw' });
    const imp = await request(
      'POST',
      '/catalogue/import',
      { questions: [SAMPLE_Q], resources: [SAMPLE_R], dryRun: false, persist: true },
      tea.body.token
    );
    assert.equal(imp.status, 201);
    assert.ok(imp.body.nAccepted >= 1);

    const listed = await request(
      'GET',
      '/catalogue/questions?topicId=hist_sl_rajarata_politics&includeKeys=true',
      null,
      tea.body.token
    );
    const q = (listed.body.questions || []).find((x) => x.questionId === SAMPLE_Q.questionId);
    assert.ok(q, 'question imported');
    assert.equal(q.automatedValidation, 'passed');
    assert.equal(q.learnerAvailability, 'draft');

    const pub2 = await request(
      'POST',
      `/catalogue/questions/${SAMPLE_Q.questionId}/versions/1/publish-practice`,
      { contentHash: q.contentHash },
      tea.body.token
    );
    assert.equal(pub2.status, 200);
    assert.equal(pub2.body.learnerAvailability, 'published_practice');
    assert.notEqual(pub2.body.reviewStatus, 'approved_for_learner');
    assert.equal(pub2.body.humanReviewStatus, 'unreviewed');

    const pubR = await request(
      'POST',
      `/catalogue/resources/${SAMPLE_R.resourceId}/versions/1/publish-practice`,
      {},
      tea.body.token
    );
    assert.equal(pubR.status, 200);

    const meta = await request('GET', '/catalogue/meta', null, tea.body.token);
    assert.equal(meta.body.coverage.authenticApprovedQuestions, 0);
    assert.ok(meta.body.coverage.publishedPracticeQuestions >= 1);
    assert.equal(meta.body.coverage.teacherReviewedQuestions, 0);

    const assign = await request(
      'POST',
      '/learning/quiz/syn_s0000/assign',
      {
        catalogueMode: 'canonical',
        curriculumVersion: 'nie_al_arts_provisional_v0.1',
        subjectId: 'sub_history',
        topicId: 'hist_sl_rajarata_politics',
        language: 'en',
        nQuestions: 1,
        contentPolicy: 'published_practice',
      },
      stu.body.token
    );
    assert.equal(assign.status, 201);
    assert.equal(assign.body.isTestFixture, false);
    assert.ok(
      (assign.body.questions[0].provenanceLabels || []).some((l) => /not teacher-reviewed/i.test(l))
    );

    const recs = await request(
      'GET',
      '/learning/recommendations/syn_s0000?catalogueMode=canonical&subjectId=sub_history&contentPolicy=published_practice',
      null,
      stu.body.token
    );
    assert.equal(recs.status, 200);
    assert.ok((recs.body.recommendations || []).length >= 1);
    assert.ok(
      (recs.body.recommendations[0].provenanceLabels || []).some((l) => /AI-authored|Not teacher/i.test(l))
    );
  });

  it('teacher_reviewed_only excludes unreviewed practice', async () => {
    const stu = await request('POST', '/auth/login', { username: 'stu', password: 'pw' });
    const assign = await request(
      'POST',
      '/learning/quiz/syn_s0000/assign',
      {
        catalogueMode: 'canonical',
        subjectId: 'sub_history',
        topicId: 'hist_sl_rajarata_politics',
        language: 'en',
        nQuestions: 1,
        contentPolicy: 'teacher_reviewed_only',
      },
      stu.body.token
    );
    assert.equal(assign.status, 409);
    assert.equal(assign.body.error, 'canonical_question_bank_unavailable');
  });

  it('fixtures remain excluded from practice publication', async () => {
    const tea = await request('POST', '/auth/login', { username: 'tea', password: 'pw' });
    const fixtureQ = {
      ...SAMPLE_Q,
      questionId: 'prac_test_fixture_q01',
      isTestFixture: true,
      contentOrigin: 'machine_authored_test_fixture',
      provenance: 'machine_authored_test_fixture_not_past_paper',
      permissionStatus: 'test_fixture_internal_use_only',
    };
    await request(
      'POST',
      '/catalogue/import',
      { questions: [fixtureQ], dryRun: false, persist: true },
      tea.body.token
    );
    const listed = await request(
      'GET',
      '/catalogue/questions?includeFixtures=true&includeKeys=true',
      null,
      tea.body.token
    );
    const fq = (listed.body.questions || []).find((x) => x.questionId === fixtureQ.questionId);
    assert.ok(fq);
    const pub = await request(
      'POST',
      `/catalogue/questions/${fixtureQ.questionId}/versions/1/publish-practice`,
      { contentHash: fq.contentHash },
      tea.body.token
    );
    assert.equal(pub.status, 409);
    assert.equal(pub.body.error, 'fixtures_cannot_be_published_as_practice');
  });

  it('generated content does not inflate authentic coverage', async () => {
    const tea = await request('POST', '/auth/login', { username: 'tea', password: 'pw' });
    const meta = await request('GET', '/catalogue/meta', null, tea.body.token);
    assert.equal(meta.body.nApprovedNonFixtureQuestions, 0);
    assert.equal(meta.body.coverage.authenticApprovedQuestions, 0);
    assert.ok(meta.body.coverage.publishedPracticeQuestions >= 1);
    assert.ok(meta.body.coverage.aiAuthoredPublishedQuestions >= 1);
  });
});
