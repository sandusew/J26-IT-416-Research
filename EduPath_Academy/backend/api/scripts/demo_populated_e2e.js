/**
 * Populated end-to-end demo against local Express+Mongo (+ optional ML).
 * Learner actions are labelled demo/test (synthetic users).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const API = process.env.API_BASE || 'http://127.0.0.1:4000';
const ML = process.env.ML_INFERENCE_URL || 'http://127.0.0.1:8000';

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
    console.log(ok ? 'PASS' : 'FAIL', name, typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 200));
  };

  const health = await req('GET', '/health').catch((e) => ({ status: 0, body: String(e) }));
  push('api_health', health.status === 200, health.status);

  const mlReady = await req('GET', '/ready', null, null, ML).catch((e) => ({
    status: 0,
    body: { error: String(e) },
  }));
  push(
    'ml_ready',
    mlReady.status === 200 && mlReady.body.ready === true,
    mlReady.body.serving?.knowledge_domain_index?.corpus_version || mlReady.body
  );

  const loginStu = await req('POST', '/auth/login', { username: 'demo_stu', password: 'pw' });
  const loginTea = await req('POST', '/auth/login', { username: 'demo_tea', password: 'pw' });
  push('auth_student', loginStu.status === 200 && !!loginStu.body.token, loginStu.status);
  push('auth_teacher', loginTea.status === 200 && !!loginTea.body.token, loginTea.status);
  const stuTok = loginStu.body.token;
  const teaTok = loginTea.body.token;
  const studentId = loginStu.body.user.studentId;

  const meta = await req('GET', '/catalogue/meta', null, teaTok);
  push(
    'catalogue_meta_practice',
    meta.status === 200 && meta.body.coverage?.publishedPracticeQuestions >= 12,
    meta.body.coverage
  );
  push(
    'authentic_still_zero',
    meta.body.coverage?.authenticApprovedQuestions === 0,
    meta.body.coverage?.authenticApprovedQuestions
  );

  const topicsSmoke = [
    { subjectId: 'sub_history', topicId: 'hist_sl_rajarata_politics' },
    { subjectId: 'sub_geography', topicId: 'geo_climate' },
    { subjectId: 'sub_political', topicId: 'pol_forms_gov' },
    { subjectId: 'sub_economics', topicId: 'eco_demand_supply' },
  ];
  for (const t of topicsSmoke) {
    const assign = await req(
      'POST',
      `/learning/quiz/${studentId}/assign`,
      {
        catalogueMode: 'canonical',
        subjectId: t.subjectId,
        topicId: t.topicId,
        language: 'en',
        nQuestions: 3,
        contentPolicy: 'published_practice',
      },
      stuTok
    );
    push(`assign_${t.topicId}`, assign.status === 201, {
      status: assign.status,
      n: assign.body.nQuestions,
      labels: assign.body.questions?.[0]?.provenanceLabels,
    });
    if (assign.status !== 201) continue;
    const responses = assign.body.questions.map((q) => ({
      questionId: q.questionId,
      // wrong on purpose for some variety — scoring still works
      response: Array.isArray(q.options) ? q.options[0] : 'Anuradhapura',
    }));
    const submit = await req(
      'POST',
      `/learning/quiz/${studentId}/assignments/${assign.body.assignmentId}/submit`,
      { responses },
      stuTok
    );
    push(`submit_${t.topicId}`, submit.status === 200 || submit.status === 201, {
      status: submit.status,
      score: submit.body.score,
    });
    // idempotent / duplicate-submit semantics (same payload → safe result, not double-count)
    const submit2 = await req(
      'POST',
      `/learning/quiz/${studentId}/assignments/${assign.body.assignmentId}/submit`,
      { responses },
      stuTok
    );
    const idemOk =
      submit2.status === 200 ||
      submit2.status === 201 ||
      (submit2.status === 409 &&
        /already|duplicate|submitted|idempotent/i.test(
          String(submit2.body?.error || submit2.body?.note || '')
        ));
    push(`idempotent_${t.topicId}`, idemOk, {
      status: submit2.status,
      error: submit2.body?.error,
      score: submit2.body?.score ?? submit.body?.score,
    });
  }

  const twin = await req('GET', `/learning/digital-twin/${studentId}`, null, stuTok);
  push('twin_read', twin.status === 200, {
    status: twin.status,
    keys: twin.body && typeof twin.body === 'object' ? Object.keys(twin.body).slice(0, 12) : [],
  });

  const progress = await req('GET', `/learning/progress/${studentId}`, null, stuTok);
  push('progress_read', progress.status === 200 || progress.status === 404, progress.status);

  const recs = await req(
    'GET',
    `/learning/recommendations/${studentId}?catalogueMode=canonical&subjectId=sub_history&contentPolicy=published_practice`,
    null,
    stuTok
  );
  push('recommendations', recs.status === 200 && (recs.body.recommendations || []).length > 0, {
    n: recs.body.nEligible || (recs.body.recommendations || []).length,
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
  push('domain_chat', chat.status === 200, {
    status: chat.status,
    corpus: chat.body.corpus_mode || chat.body.corpusMode,
    citations: (chat.body.citations || []).length,
    answer_type: chat.body.answer_type,
    provenance_hint: chat.body.content_origin || chat.body.corpus_provenance,
  });

  const start = new Date(Date.now() + 86400000);
  const end = new Date(start.getTime() + 3600000);
  const consult = await req(
    'POST',
    '/consultations',
    {
      studentId,
      teacherId: 'demo_t0001',
      subjectId: 'sub_history',
      requestedSlotStart: start.toISOString(),
      requestedSlotEnd: end.toISOString(),
    },
    stuTok
  ).catch((e) => ({ status: 0, body: String(e) }));
  push('consultation_request', consult.status === 201, {
    status: consult.status,
    meetingIntegrationStatus: consult.body?.consultation?.meetingIntegrationStatus,
    meetingUrl: consult.body?.consultation?.meetingUrl,
  });
  if (consult.status === 201) {
    const approve = await req(
      'PATCH',
      `/consultations/${consult.body.consultation.consultationId}/state`,
      { state: 'approved' },
      teaTok
    );
    push('consultation_approve_unconfigured', approve.status === 200 || approve.status === 201, {
      status: approve.status,
      meetingUrl: approve.body?.consultation?.meetingUrl ?? approve.body?.meetingUrl,
      note: 'URL may be null when meeting provider unconfigured',
    });
    const cancel = await req(
      'PATCH',
      `/consultations/${consult.body.consultation.consultationId}/state`,
      { state: 'cancelled' },
      stuTok
    );
    push('consultation_cancel', cancel.status === 200 || cancel.status === 201, cancel.status);
  }

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
  push('strict_mode_empty_bank', strict.status === 409, strict.body.error);

  const passed = steps.filter((s) => s.ok).length;
  const failed = steps.filter((s) => !s.ok).length;
  const report = {
    generated_at_utc: new Date().toISOString(),
    api: API,
    ml: ML,
    studentId,
    passed,
    failed,
    steps,
    note: 'Demo users are synthetic; content may be AI-authored published practice',
  };
  const out = path.join(__dirname, '..', 'reports', 'demo_populated_e2e.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed, failed, out }, null, 2));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
