/**
 * PP1 frontend gateway additions — isolated memory Mongo.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_frontend_ext';
process.env.ARTS_AI_ALLOW_TEST_FIXTURES = 'false';

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
      key.includes(`${path.sep}src${path.sep}services${path.sep}`) ||
      key.includes(`${path.sep}src${path.sep}middleware${path.sep}`)
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

before(async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  mem = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mem.getUri('arts_ai_fe_ext_test');
  process.env.ARTS_AI_MONGO_URI_SOURCE = 'shell';
  clearConfigCache();
  mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../src/models/User');
  const bcrypt = require('bcryptjs');
  await User.deleteMany({});
  await User.create([
    {
      username: 'fe_stu',
      passwordHash: await bcrypt.hash('pw', 4),
      role: 'student',
      displayName: 'FE Student',
      studentId: 'fe_s1',
    },
    {
      username: 'fe_tea',
      passwordHash: await bcrypt.hash('pw', 4),
      role: 'teacher',
      displayName: 'FE Teacher',
      teacherId: 'fe_t1',
    },
  ]);
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/auth', require('../src/routes/auth'));
  app.use('/consultations', require('../src/routes/consultations'));
  app.use('/ml', require('../src/routes/ml'));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  basePort = server.address().port;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (mongoose?.connection?.readyState) await mongoose.disconnect();
  if (mem) await mem.stop();
});

describe('frontend gateway extensions', () => {
  it('lists teachers without secrets', async () => {
    const login = await request('POST', '/auth/login', { username: 'fe_stu', password: 'pw' });
    assert.equal(login.status, 200);
    const res = await request('GET', '/auth/teachers', null, login.body.token);
    assert.equal(res.status, 200);
    assert.ok(res.body.teachers.some((t) => t.teacherId === 'fe_t1'));
    assert.ok(!JSON.stringify(res.body).toLowerCase().includes('password'));
  });

  it('teacher inbox ownership enforced', async () => {
    const tea = await request('POST', '/auth/login', { username: 'fe_tea', password: 'pw' });
    const stu = await request('POST', '/auth/login', { username: 'fe_stu', password: 'pw' });
    const ok = await request('GET', '/consultations/teacher/fe_t1', null, tea.body.token);
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.body.consultations));
    const denied = await request('GET', '/consultations/teacher/fe_t1', null, stu.body.token);
    assert.equal(denied.status, 403);
  });

  it('students cannot call Model Explorer ML proxies', async () => {
    const stu = await request('POST', '/auth/login', { username: 'fe_stu', password: 'pw' });
    for (const p of [
      '/ml/behaviour/cluster',
      '/ml/risk/predict',
      '/ml/correctness/predict',
      '/ml/topic/classify',
      '/ml/recommendations/score',
    ]) {
      const res = await request('POST', p, {}, stu.body.token);
      assert.equal(res.status, 403, p);
    }
  });
});
