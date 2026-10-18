/**
 * Live smoke: Express → FastAPI trained_ranker scoring (requires ML on :8000).
 * Uses mongodb-memory-server; writes reports/trained_ranker_express_smoke.json
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

async function main() {
  process.env.ML_INFERENCE_URL = process.env.ML_INFERENCE_URL || 'http://127.0.0.1:8000';
  const mongoose = require('mongoose');
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mem = await MongoMemoryServer.create({ instance: { dbName: `arts_ai_rank_${Date.now()}` } });
  await mongoose.connect(mem.getUri());

  const express = require('express');
  const bcrypt = require('bcryptjs');
  const User = require('../src/models/User');
  await User.deleteMany({});
  await User.create({
    username: 'stu',
    role: 'student',
    displayName: 'S',
    studentId: 'syn_s0000',
    passwordHash: await bcrypt.hash('pw', 4),
    isSyntheticFixture: true,
  });

  const app = express();
  app.use(express.json());
  app.use('/auth', require('../src/routes/auth'));
  app.use('/learning', require('../src/routes/learning'));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const call = (method, url, body, token) =>
    new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: url,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          },
          timeout: 30000,
        },
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => {
            let json;
            try {
              json = JSON.parse(buf || '{}');
            } catch {
              json = { raw: buf };
            }
            resolve({ status: res.statusCode, body: json });
          });
        }
      );
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });

  // Probe ML
  let mlReady;
  try {
    const r = await fetch(`${process.env.ML_INFERENCE_URL}/ready`);
    mlReady = await r.json();
  } catch (e) {
    mlReady = { ready: false, error: String(e.message || e) };
  }

  const login = await call('POST', '/auth/login', { username: 'stu', password: 'pw' });
  const token = login.body.token;
  const rec = await call(
    'GET',
    '/learning/recommendations/syn_s0000?subjectId=sub_history&policyMode=trained_ranker',
    null,
    token
  );
  const def = await call(
    'GET',
    '/learning/recommendations/syn_s0000?subjectId=sub_history',
    null,
    token
  );

  const report = {
    tested_at: new Date().toISOString(),
    ml_inference_url: process.env.ML_INFERENCE_URL,
    ml_ready: mlReady,
    login_status: login.status,
    default_policy: {
      status: def.status,
      policyMode: def.body.policyMode,
      trainedScorerUsed: def.body.trainedScorerUsed,
    },
    trained_ranker: {
      status: rec.status,
      policyMode: rec.body.policyMode,
      trainedScorerUsed: rec.body.trainedScorerUsed,
      modelVersion: rec.body.modelVersion,
      fallbackReason: rec.body.fallbackReason,
      nEligible: rec.body.nEligible,
      nRecommendations: (rec.body.recommendations || []).length,
      sampleScores: (rec.body.recommendations || []).slice(0, 3).map((x) => ({
        resourceId: x.resourceId,
        score: x.score,
        rank: x.rank,
      })),
    },
    pass:
      rec.status === 200 &&
      rec.body.trainedScorerUsed === true &&
      rec.body.policyMode === 'trained_ranker' &&
      Boolean(rec.body.modelVersion) &&
      def.body.policyMode === 'prerequisite_aware' &&
      def.body.trainedScorerUsed === false,
  };

  const outDir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'trained_ranker_express_smoke.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, out, trained: report.trained_ranker }, null, 2));

  server.close();
  await mongoose.disconnect();
  await mem.stop();
  process.exit(report.pass ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
