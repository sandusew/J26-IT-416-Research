/**
 * Verify every English working-scope topic can assign a 12-question quiz
 * with 12 distinct logical question IDs; keys hidden before submit.
 */
const fs = require('fs');
const path = require('path');

const API = process.env.API_BASE || 'http://127.0.0.1:4000';
const OUT = path.join(__dirname, '..', 'reports', 'topic_quiz_capacity.json');

async function req(method, urlPath, token, body) {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function main() {
  const login = await req('POST', '/auth/login', null, {
    username: 'demo_stu',
    password: 'pw',
  });
  if (login.status !== 200 || !login.json.token) {
    console.error('auth_failed', login.status, login.json);
    process.exit(1);
  }
  const token = login.json.token;
  const studentId = login.json.user?.studentId || login.json.user?.id || login.json.user?._id;

  const meta = await req('GET', '/catalogue/meta', token);
  const topics = (meta.json.topics || meta.json.workingTopics || []).filter(
    (t) => t.language === 'en' || t.language === 'english' || !t.language
  );
  // Fallback: registry topics via coverage
  let topicList = topics.map((t) => ({
    topicId: t.topicId || t.topic_id,
    subjectId: t.subjectId || t.subject_id,
  }));
  if (!topicList.length) {
    const regPath = path.join(
      __dirname,
      '..',
      '..',
      'ml',
      'data',
      'curriculum',
      'nie_al_arts_provisional_v0.1_registry.json'
    );
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    topicList = (reg.topics || [])
      .filter((t) => (t.language || 'en') === 'en' || !t.language)
      .filter((t) => t.subject_id !== 'sub_sinhala_lit')
      .map((t) => ({ topicId: t.topic_id, subjectId: t.subject_id }));
  }

  const rows = [];
  let pass = 0;
  let fail = 0;
  for (const t of topicList) {
    const assign = await req('POST', `/learning/quiz/${studentId}/assign`, token, {
      curriculumVersion: 'nie_al_arts_provisional_v0.1',
      subjectId: t.subjectId,
      topicId: t.topicId,
      language: 'en',
      nQuestions: 12,
      contentPolicy: 'published_practice',
    });
    const qs = assign.json.questions || assign.json.assignment?.questions || [];
    const ids = qs.map((q) => q.questionId);
    const distinct = new Set(ids);
    const keysHidden = qs.every((q) => q.correctAnswerOrRubric === undefined);
    const ok =
      assign.status === 201 &&
      qs.length === 12 &&
      distinct.size === 12 &&
      keysHidden;
    if (ok) pass += 1;
    else fail += 1;
    rows.push({
      topicId: t.topicId,
      subjectId: t.subjectId,
      status: assign.status,
      n: qs.length,
      distinct: distinct.size,
      keysHidden,
      ok,
      error: assign.json.error || null,
      available: assign.json.available,
    });
  }

  const report = {
    generated_at_utc: new Date().toISOString(),
    api: API,
    n_topics: topicList.length,
    passed: pass,
    failed: fail,
    rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: OUT, passed: pass, failed: fail, n: topicList.length }, null, 2));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
