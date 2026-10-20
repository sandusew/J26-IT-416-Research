/**
 * Peer membership and consultation notification recovery. Isolated memory Mongo.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_peer_consult';
delete process.env.ARTS_AI_ALLOW_TEST_FIXTURES;

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');

let mongoose;
let mem;
let server;
let basePort;
let Notification;

function clearConfigCache() {
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
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed = raw;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            /* keep text */
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

async function login(username) {
  const res = await request('POST', '/auth/login', { username, password: 'pw' });
  assert.equal(res.status, 200, username);
  return res.body.token;
}

before(async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  mem = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mem.getUri('arts_ai_peer_consult');
  process.env.ARTS_AI_MONGO_URI_SOURCE = 'shell';
  clearConfigCache();
  mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../src/models/User');
  const bcrypt = require('bcryptjs');
  Notification = require('../src/models/PeerGroup').Notification;
  await User.create([
    {
      username: 'own_stu',
      passwordHash: await bcrypt.hash('pw', 4),
      role: 'student',
      displayName: 'Owner',
      studentId: 'own_s',
    },
    {
      username: 'join_stu',
      passwordHash: await bcrypt.hash('pw', 4),
      role: 'student',
      displayName: 'Joiner',
      studentId: 'join_s',
    },
    {
      username: 'stranger_stu',
      passwordHash: await bcrypt.hash('pw', 4),
      role: 'student',
      displayName: 'Stranger',
      studentId: 'stranger_s',
    },
    {
      username: 'tea_w',
      passwordHash: await bcrypt.hash('pw', 4),
      role: 'teacher',
      displayName: 'Teacher',
      teacherId: 'tea_w',
    },
  ]);
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/auth', require('../src/routes/auth'));
  app.use('/learning', require('../src/routes/learning'));
  app.use('/consultations', require('../src/routes/consultations'));
  app.use('/ml', require('../src/routes/ml'));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  basePort = server.address().port;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose?.connection?.readyState) await mongoose.disconnect();
  if (mem) await mem.stop();
});

describe('peer groups and consultations', () => {
  it('approves one membership, rejects duplicates, capacity, and outsiders', async () => {
    const owner = await login('own_stu');
    const joiner = await login('join_stu');
    const stranger = await login('stranger_stu');
    const teacher = await login('tea_w');
    const created = await request(
      'POST',
      '/learning/peer-groups',
      {
        name: 'History circle',
        subjectId: 'sub_history',
        maxMembers: 2,
        requireApproval: true,
      },
      owner
    );
    assert.equal(created.status, 201);
    const groupId = created.body.group.groupId;
    const requested = await request('POST', `/learning/peer-groups/${groupId}/join-request`, {}, joiner);
    assert.equal(requested.status, 201);
    const requestId = requested.body.joinRequest.requestId;
    const duplicate = await request('POST', `/learning/peer-groups/${groupId}/join-request`, {}, joiner);
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error, 'join_request_pending');
    assert.equal(
      await request('POST', `/learning/peer-groups/${groupId}/join-requests/${requestId}/approve`, {}, stranger)
        .then((res) => res.status),
      403
    );
    assert.equal(
      await request('POST', `/learning/peer-groups/${groupId}/join-requests/${requestId}/approve`, {}, teacher)
        .then((res) => res.status),
      403
    );
    const approved = await request(
      'POST',
      `/learning/peer-groups/${groupId}/join-requests/${requestId}/approve`,
      {},
      owner
    );
    assert.equal(approved.status, 200);
    const repeat = await request(
      'POST',
      `/learning/peer-groups/${groupId}/join-requests/${requestId}/approve`,
      {},
      owner
    );
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body.idempotent, true);
    const mine = await request('GET', '/learning/peer-groups/mine', null, joiner);
    assert.equal(mine.status, 200);
    assert.ok(mine.body.groups.some((group) => group.groupId === groupId));
    const full = await request('POST', `/learning/peer-groups/${groupId}/join-request`, {}, stranger);
    assert.equal(full.status, 409);
    assert.equal(full.body.error, 'capacity_full');
  });

  it('keeps consultation notifications owned, idempotent, and without a meeting link', async () => {
    const student = await login('own_stu');
    const teacher = await login('tea_w');
    const other = await login('join_stu');
    const start = '2026-11-02T04:30:00.000Z';
    const end = '2026-11-02T05:00:00.000Z';
    const created = await request(
      'POST',
      '/consultations',
      { teacherId: 'tea_w', subjectId: 'sub_history', requestedSlotStart: start, requestedSlotEnd: end },
      student
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.consultation.meetingUrl, null);
    const consultationId = created.body.consultation.consultationId;
    const invalid = await request(
      'POST',
      '/consultations',
      {
        teacherId: 'tea_w',
        requestedSlotStart: 'not-a-date',
        requestedSlotEnd: end,
      },
      student
    );
    assert.equal(invalid.status, 400);
    const conflict = await request(
      'POST',
      '/consultations',
      { teacherId: 'tea_w', requestedSlotStart: start, requestedSlotEnd: end },
      other
    );
    assert.equal(conflict.status, 409);
    const approved = await request('PATCH', `/consultations/${consultationId}/state`, { state: 'approved' }, teacher);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.consultation.meetingUrl, null);
    assert.equal(approved.body.consultation.state, 'approved');
    const noteId = `ntf_con_${consultationId}_approved`;
    assert.equal(await Notification.countDocuments({ notificationId: noteId, userId: 'own_s' }), 1);
    const again = await request('PATCH', `/consultations/${consultationId}/state`, { state: 'approved' }, teacher);
    assert.equal(again.status, 200);
    assert.equal(again.body.idempotent, true);
    assert.equal(await Notification.countDocuments({ notificationId: noteId }), 1);
    await Notification.deleteOne({ notificationId: noteId });
    const repaired = await request('PATCH', `/consultations/${consultationId}/state`, { state: 'approved' }, teacher);
    assert.equal(repaired.status, 200);
    assert.equal(await Notification.countDocuments({ notificationId: noteId, userId: 'own_s' }), 1);
    const outsider = await request('POST', `/learning/notifications/${noteId}/read`, {}, other);
    assert.equal(outsider.status, 404);
    const unread = await request('GET', '/learning/notifications/me', null, student);
    const row = unread.body.notifications.find((item) => item.notificationId === noteId);
    assert.equal(row.read, false);
    const marked = await request('POST', `/learning/notifications/${noteId}/read`, {}, student);
    assert.equal(marked.status, 200);
    assert.equal(marked.body.notification.read, true);
    const persisted = await request('GET', '/learning/notifications/me', null, student);
    assert.equal(
      persisted.body.notifications.find((item) => item.notificationId === noteId).read,
      true
    );
    const denied = await request('POST', '/consultations', { teacherId: 'tea_w' }, null);
    assert.equal(denied.status, 401);
    const chat = await request('POST', '/ml/chat/own_s/ask', { question: '' }, student);
    assert.equal(chat.status, 400);
    const longQuestion = await request(
      'POST',
      '/ml/chat/own_s/ask',
      { question: 'x'.repeat(2001), corpus_mode: 'domain' },
      student
    );
    assert.equal(longQuestion.status, 400);
    const fixture = await request(
      'POST',
      '/ml/chat/own_s/ask',
      { question: 'What is a kingdom?', corpus_mode: 'fixture' },
      student
    );
    assert.equal(fixture.status, 403);
  });
});
