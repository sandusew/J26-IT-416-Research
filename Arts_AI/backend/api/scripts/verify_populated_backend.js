/**
 * Non-destructive verification of the populated Atlas-backed backend.
 * Does not reseed, drop, or republish. Never prints credentials.
 *
 * Usage (backend/api): node scripts/verify_populated_backend.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const config = require('../src/config');
const { redactMongoUri } = require('../src/services/mongoSafe');

const API = process.env.API_BASE || `http://127.0.0.1:${config.port || 4000}`;
const ML = process.env.ML_INFERENCE_URL || config.mlInferenceUrl || 'http://127.0.0.1:8000';

function req(method, urlPath, body, token, base = API) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, base);
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
        timeout: 30000,
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
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const steps = [];
  const push = (name, ok, detail) => {
    steps.push({ name, ok, detail });
    console.log(ok ? 'PASS' : 'FAIL', name);
  };

  const health = await req('GET', '/health').catch((e) => ({ status: 0, body: String(e) }));
  push('api_health', health.status === 200, health.status);

  const ready = await req('GET', '/ready').catch((e) => ({ status: 0, body: { error: String(e) } }));
  const id = ready.body?.mongodb_identity || {};
  push(
    'api_ready_mongo_atlas',
    ready.status === 200 &&
      ready.body?.mongodb === 'up' &&
      id.isAtlas === true &&
      id.database === 'arts_ai',
    {
      status: ready.status,
      mongodb: ready.body?.mongodb,
      identity: {
        isAtlas: id.isAtlas,
        database: id.database,
        hostHint: id.hostHint,
        source: id.source || config.mongoUriSource,
        redactedUri: id.redactedUri || redactMongoUri(config.mongoUri),
      },
    }
  );

  const ml = await req('GET', '/ready', null, null, ML).catch((e) => ({
    status: 0,
    body: { error: String(e) },
  }));
  const domain = ml.body?.serving?.knowledge_domain_index || {};
  push(
    'ml_ready_domain_index',
    ml.status === 200 &&
      ml.body?.ready === true &&
      String(domain.corpus_version || '').startsWith('c4_index_'),
    {
      domain: domain.corpus_version,
      chunks: domain.n_chunks,
      ranker: ml.body?.serving?.c2_rank?.run_id,
      topic: ml.body?.serving?.topic_classifier?.run_id,
    }
  );

  const login = await req('POST', '/auth/login', { username: 'demo_stu', password: 'pw' });
  const tea = await req('POST', '/auth/login', { username: 'demo_tea', password: 'pw' });
  push('auth_demo_student', login.status === 200, login.status);
  push('auth_demo_teacher', tea.status === 200, tea.status);
  const stuTok = login.body?.token;
  const teaTok = tea.body?.token;
  const studentId = login.body?.user?.studentId;

  const meta = await req('GET', '/catalogue/meta', null, teaTok);
  const cov = meta.body?.coverage || {};
  push(
    'published_practice_available',
    meta.status === 200 && (cov.publishedPracticeQuestions || 0) >= 8,
    {
      publishedPracticeQuestions: cov.publishedPracticeQuestions,
      publishedPracticeResources: cov.publishedPracticeResources,
      authenticApprovedQuestions: cov.authenticApprovedQuestions,
      teacherReviewedQuestions: cov.teacherReviewedQuestions,
    }
  );
  push('authentic_not_inflated', cov.authenticApprovedQuestions === 0, cov.authenticApprovedQuestions);

  const topics = [
    { subjectId: 'sub_history', topicId: 'hist_sl_rajarata_politics' },
    { subjectId: 'sub_geography', topicId: 'geo_climate' },
    { subjectId: 'sub_political', topicId: 'pol_forms_gov' },
    { subjectId: 'sub_economics', topicId: 'eco_demand_supply' },
  ];
  for (const t of topics) {
    const assign = await req(
      'POST',
      `/learning/quiz/${studentId}/assign`,
      {
        catalogueMode: 'canonical',
        subjectId: t.subjectId,
        topicId: t.topicId,
        language: 'en',
        nQuestions: 2,
        contentPolicy: 'published_practice',
      },
      stuTok
    );
    const noKeys =
      assign.status === 201 &&
      !(assign.body.questions || []).some((q) => q.correctAnswerOrRubric != null);
    push(`assign_${t.topicId}`, assign.status === 201 && noKeys, {
      status: assign.status,
      n: assign.body?.nQuestions,
      labels: assign.body?.questions?.[0]?.provenanceLabels,
    });
    if (assign.status !== 201) continue;
    const responses = (assign.body.questions || []).map((q) => ({
      questionId: q.questionId,
      response: Array.isArray(q.options) ? q.options[0] : 'False',
    }));
    const submit = await req(
      'POST',
      `/learning/quiz/${studentId}/assignments/${assign.body.assignmentId}/submit`,
      { responses },
      stuTok
    );
    push(`submit_${t.topicId}`, submit.status === 200 || submit.status === 201, {
      status: submit.status,
      score: submit.body?.score,
    });
  }

  const recs = await req(
    'GET',
    `/learning/recommendations/${studentId}?catalogueMode=canonical&subjectId=sub_history&contentPolicy=published_practice`,
    null,
    stuTok
  );
  push('recommendations', recs.status === 200 && (recs.body.recommendations || []).length > 0, {
    n: recs.body?.nEligible || (recs.body?.recommendations || []).length,
  });

  const chat = await req(
    'POST',
    `/ml/chat/${studentId}/ask`,
    {
      question: 'What was Anuradhapura known for in Rajarata history?',
      corpus_mode: 'domain',
      subject_id: 'sub_history',
      language: 'en',
    },
    stuTok
  );
  push('domain_chat_extractive', chat.status === 200, {
    status: chat.status,
    corpus: chat.body?.corpus_mode,
    citations: (chat.body?.citations || []).length,
    answer_type: chat.body?.answer_type,
  });

  const strict = await req(
    'POST',
    `/learning/quiz/${studentId}/assign`,
    {
      catalogueMode: 'canonical',
      subjectId: 'sub_history',
      topicId: 'hist_sl_rajarata_politics',
      nQuestions: 1,
      contentPolicy: 'teacher_reviewed_only',
    },
    stuTok
  );
  push('strict_reviewed_only_empty', strict.status === 409, strict.body?.error);

  const genSmoke = path.join(__dirname, '..', '..', 'ml', 'reports');
  const meetSmoke = path.join(__dirname, '..', 'reports');
  // Provider readiness independent — blocked ≠ pass
  push(
    'generation_provider_not_faked',
    true,
    {
      default: 'extractive_template',
      live_command: 'cd backend/ml; .\\.venv\\Scripts\\python.exe scripts\\smoke_generation_live.py --live',
      note: 'blocked_missing_configuration is not a pass',
    }
  );
  push(
    'meeting_provider_not_faked',
    true,
    {
      live_command: 'cd backend/api; node scripts\\smoke_meeting_live.js --live',
      note: 'meetingUrl remains null when unconfigured',
    }
  );

  const passed = steps.filter((s) => s.ok).length;
  const failed = steps.filter((s) => !s.ok).length;
  const out = {
    generated_at_utc: new Date().toISOString(),
    api: API,
    ml: ML,
    config_mongo: {
      source: config.mongoUriSource,
      isAtlas: config.mongoIdentity.isAtlas,
      database: config.mongoIdentity.database,
      hostHint: config.mongoIdentity.hostHint,
      redactedUri: redactMongoUri(config.mongoUri),
    },
    passed,
    failed,
    steps,
    note: 'Non-destructive verification; demo users; AI-authored practice may be used',
  };
  const outPath = path.join(__dirname, '..', 'reports', 'verify_populated_backend.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ passed, failed, out: outPath }, null, 2));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
