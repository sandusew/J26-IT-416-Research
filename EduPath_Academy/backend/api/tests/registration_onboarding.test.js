/**
 * Registration, onboarding, history, and the 21-day observation window.
 * Isolated memory Mongo. Not research evidence.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_registration';
process.env.ARTS_AI_ALLOW_TEST_FIXTURES = 'false';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');

let mongoose;
let mem;
let server;
let basePort;
let observationWindow;

function clearConfigCache() {
  delete require.cache[require.resolve('../src/config')];
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
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = raw;
          try {
            parsed = raw ? JSON.parse(raw) : null;
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

const valid = (studentId, email) => ({
  studentId,
  displayName: 'New Student',
  school: 'Test College',
  email,
  password: 'password1',
  confirmPassword: 'password1',
  grade: '12',
  subjectIds: ['sub_history'],
});

before(async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  mem = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mem.getUri('arts_ai_register_test');
  process.env.ARTS_AI_MONGO_URI_SOURCE = 'shell';
  clearConfigCache();
  mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/auth', require('../src/routes/auth'));
  app.use('/learning', require('../src/routes/learning'));
  observationWindow = require('../src/services/quizSubmission').observationWindow;
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  basePort = server.address().port;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose?.connection?.readyState) await mongoose.disconnect();
  if (mem) await mem.stop();
});

describe('registration and profile', () => {
  it('registers a student, logs in with the student id, and keeps demo-style accounts separate', async () => {
    const created = await request('POST', '/auth/register', valid('stu_new_1', 'new1@example.com'));
    assert.equal(created.status, 201);
    assert.equal(created.body.user.role, 'student');
    assert.equal(created.body.user.username, 'stu_new_1');
    assert.equal(created.body.user.onboardingStatus, 'not_started');
    assert.equal(JSON.stringify(created.body).includes('password'), false);

    const login = await request('POST', '/auth/login', { username: 'stu_new_1', password: 'password1' });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.studentId, 'stu_new_1');

    const bcrypt = require('bcryptjs');
    const User = require('../src/models/User');
    await User.create({
      username: 'demo_keep',
      passwordHash: await bcrypt.hash('pw', 4),
      role: 'student',
      displayName: 'Demo Keep',
      studentId: 'demo_keep_1',
    });
    const demo = await request('POST', '/auth/login', { username: 'demo_keep', password: 'pw' });
    assert.equal(demo.status, 200);
    assert.equal(demo.body.user.onboardingStatus, 'not_required');
  });

  it('rejects invalid fields, role escalation, and duplicate ids', async () => {
    const bad = await request('POST', '/auth/register', { ...valid('ab', 'bad@example.com'), role: 'admin', password: 'short' });
    assert.equal(bad.status, 400);
    const first = await request('POST', '/auth/register', { ...valid('stu_dup', 'dup@example.com'), role: 'admin' });
    assert.equal(first.status, 201);
    assert.equal(first.body.user.role, 'student');
    const dupId = await request('POST', '/auth/register', valid('stu_dup', 'other@example.com'));
    const dupEmail = await request('POST', '/auth/register', valid('stu_other', 'dup@example.com'));
    assert.equal(dupId.status, 409);
    assert.equal(dupEmail.status, 409);
    const pair = await Promise.all([
      request('POST', '/auth/register', valid('stu_race', 'race1@example.com')),
      request('POST', '/auth/register', valid('stu_race', 'race2@example.com')),
    ]);
    const statuses = pair.map((row) => row.status).sort();
    assert.deepEqual(statuses, [201, 409]);
  });

  it('lets the owner edit profile fields and blocks role changes', async () => {
    const login = await request('POST', '/auth/login', { username: 'stu_new_1', password: 'password1' });
    const denied = await request('PATCH', '/auth/profile', { role: 'admin' }, login.body.token);
    assert.equal(denied.status, 400);
    const saved = await request(
      'PATCH',
      '/auth/profile',
      { displayName: 'Renamed Student', school: 'New School', grade: '13' },
      login.body.token
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.user.displayName, 'Renamed Student');
    assert.equal(saved.body.user.studentId, 'stu_new_1');
  });
});

describe('onboarding and history', () => {
  it('hides answer keys, scores on the server, and does not duplicate a second submit', async () => {
    const login = await request('POST', '/auth/login', { username: 'stu_new_1', password: 'password1' });
    const token = login.body.token;
    const started = await request('POST', '/learning/onboarding/stu_new_1/start', {}, token);
    assert.equal(started.status, 201);
    const raw = JSON.stringify(started.body);
    assert.equal(raw.includes('correctAnswerOrRubric'), false);
    assert.equal(raw.includes('Colombo'), true);
    const assignmentId = started.body.assignment.assignmentId;
    const responses = started.body.assignment.questions.map((q) => ({
      questionId: q.questionId,
      response:
        q.questionId === 'onb_v1_q1'
          ? 'Colombo'
          : q.questionId === 'onb_v1_q2'
            ? 'Geography'
            : q.questionId === 'onb_v1_q3'
              ? 'Economics'
              : q.questionId === 'onb_v1_q4'
                ? 'True'
                : q.questionId === 'onb_v1_q5'
                  ? 'Records from the time being studied'
                  : 'Sources can disagree or leave out facts',
    }));
    const submitted = await request(
      'POST',
      `/learning/quiz/stu_new_1/assignments/${assignmentId}/submit`,
      { responses },
      token
    );
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.score, 6);
    const again = await request(
      'POST',
      `/learning/quiz/stu_new_1/assignments/${assignmentId}/submit`,
      { responses },
      token
    );
    assert.equal(again.status, 409);
    const me = await request('GET', '/auth/me', null, token);
    assert.equal(me.body.user.onboardingStatus, 'completed');
    const history = await request('GET', '/learning/quiz/stu_new_1/history', null, token);
    assert.equal(history.body.assignments.length, 1);
    assert.equal(history.body.assignments[0].percent, 100);
    const other = await request('POST', '/auth/register', valid('stu_new_2', 'new2@example.com'));
    const denied = await request('GET', '/learning/quiz/stu_new_1/history', null, other.body.token);
    assert.equal(denied.status, 403);
    const empty = await request('GET', '/learning/progress/stu_new_2', null, other.body.token);
    assert.equal(empty.body.practiceAccuracy.ratio, null);
    assert.equal(empty.body.subjectPerformance.length, 0);
  });
});

describe('21-day observation window', () => {
  it('treats the exact end as outside the period and keeps later practice updates', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const inside = observationWindow(start, new Date(start.getTime() + 21 * 24 * 60 * 60 * 1000 - 1));
    const edge = observationWindow(start, new Date(start.getTime() + 21 * 24 * 60 * 60 * 1000));
    assert.equal(inside.withinInitialPeriod, true);
    assert.equal(edge.withinInitialPeriod, false);
    assert.match(edge.note, /not the OULAD/);
  });
});
