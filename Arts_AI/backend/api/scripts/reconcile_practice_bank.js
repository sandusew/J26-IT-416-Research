/**
 * Item-level reconciliation of practice questions: batch vs Atlas.
 * Safe diagnostics only — no secrets, no mutations.
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const config = require('../src/config');
const { redactMongoUri } = require('../src/services/mongoSafe');

const ROOT = path.join(__dirname, '..', '..');
const BATCH = path.join(ROOT, 'ml', 'data', 'arts_content', 'practice', 'batches', 'combined_import_batch.json');
const QUALITY = path.join(ROOT, 'ml', 'reports', 'practice_content_quality.json');
const PACKAGES = path.join(ROOT, 'ml', 'data', 'arts_content', 'practice', 'packages');
const OUT = path.join(__dirname, '..', 'reports', 'practice_bank_reconciliation.json');

async function main() {
  const batch = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
  const quality = fs.existsSync(QUALITY) ? JSON.parse(fs.readFileSync(QUALITY, 'utf8')) : {};

  const batchQs = batch.questions || [];
  const batchRs = batch.resources || [];
  const byId = new Map();
  const byTopic = new Map();
  const dupKeys = [];
  for (const q of batchQs) {
    const key = `${q.questionId}::${String(q.version || '1')}`;
    if (byId.has(key)) dupKeys.push(key);
    byId.set(key, q);
    const t = q.topicId || 'unknown';
    if (!byTopic.has(t)) byTopic.set(t, []);
    byTopic.get(t).push(q);
  }

  // Package-level authored/quarantine
  const packageStats = [];
  if (fs.existsSync(PACKAGES)) {
    for (const dir of fs.readdirSync(PACKAGES)) {
      const pkg = path.join(PACKAGES, dir);
      if (!fs.statSync(pkg).isDirectory()) continue;
      const qPath = path.join(pkg, 'questions.json');
      const quarPath = path.join(pkg, 'quarantine.json');
      const qs = fs.existsSync(qPath) ? JSON.parse(fs.readFileSync(qPath, 'utf8')) : [];
      const quar = fs.existsSync(quarPath) ? JSON.parse(fs.readFileSync(quarPath, 'utf8')) : [];
      packageStats.push({
        topicId: dir,
        n_package_questions: Array.isArray(qs) ? qs.length : 0,
        n_quarantine_file: Array.isArray(quar) ? quar.length : 0,
        versions: Array.isArray(qs)
          ? [...new Set(qs.map((q) => String(q.version || '1')))]
          : [],
      });
    }
  }

  console.log(
    'mongo',
    JSON.stringify({
      source: config.mongoUriSource,
      isAtlas: config.mongoIdentity.isAtlas,
      database: config.mongoIdentity.database,
      hostHint: config.mongoIdentity.hostHint,
      redactedUri: redactMongoUri(config.mongoUri),
    })
  );
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 25000 });
  const { CanonicalQuestion, CanonicalResource } = require('../src/models/Catalogue');

  const allAi = await CanonicalQuestion.find({
    contentOrigin: 'ai_authored_source_grounded',
    isTestFixture: { $ne: true },
  }).lean();
  const allAiR = await CanonicalResource.find({
    contentOrigin: 'ai_authored_source_grounded',
    isTestFixture: { $ne: true },
  }).lean();

  const published = allAi.filter((q) => q.learnerAvailability === 'published_practice');
  const draft = allAi.filter((q) => q.learnerAvailability === 'draft' || !q.learnerAvailability);
  const withdrawn = allAi.filter((q) => q.learnerAvailability === 'withdrawn');
  const passed = allAi.filter((q) => q.automatedValidation === 'passed');
  const failed = allAi.filter((q) => q.automatedValidation === 'failed');

  // Logical IDs: latest version per questionId among published
  const publishedByLogical = new Map();
  for (const q of published) {
    const prev = publishedByLogical.get(q.questionId);
    if (!prev || Number(q.version) > Number(prev.version)) publishedByLogical.set(q.questionId, q);
  }

  // Per-topic published distinct logical IDs
  const topicPub = new Map();
  for (const q of publishedByLogical.values()) {
    const t = q.topicId;
    if (!topicPub.has(t)) topicPub.set(t, []);
    topicPub.get(t).push(q.questionId);
  }

  // Batch items missing from Atlas (any version)
  const atlasKeys = new Set(allAi.map((q) => `${q.questionId}::${String(q.version)}`));
  const batchMissingInAtlas = [];
  const batchPresentNotPublished = [];
  const batchPublished = [];
  for (const q of batchQs) {
    const key = `${q.questionId}::${String(q.version || '1')}`;
    const doc = allAi.find((d) => d.questionId === q.questionId && String(d.version) === String(q.version || '1'));
    if (!doc) batchMissingInAtlas.push({ questionId: q.questionId, version: q.version, topicId: q.topicId });
    else if (doc.learnerAvailability !== 'published_practice') {
      batchPresentNotPublished.push({
        questionId: q.questionId,
        version: q.version,
        topicId: q.topicId,
        learnerAvailability: doc.learnerAvailability,
        automatedValidation: doc.automatedValidation,
      });
    } else batchPublished.push(key);
  }

  // Atlas published not in batch
  const publishedNotInBatch = published.filter(
    (q) => !byId.has(`${q.questionId}::${String(q.version)}`)
  );

  // Version history per logical ID
  const versionsById = new Map();
  for (const q of allAi) {
    if (!versionsById.has(q.questionId)) versionsById.set(q.questionId, []);
    versionsById.get(q.questionId).push({
      version: q.version,
      learnerAvailability: q.learnerAvailability,
      automatedValidation: q.automatedValidation,
      topicId: q.topicId,
    });
  }
  let multiVersionLogical = 0;
  let supersededUnpublished = 0;
  for (const [, vers] of versionsById) {
    if (vers.length > 1) multiVersionLogical += 1;
    const pubs = vers.filter((v) => v.learnerAvailability === 'published_practice');
    const drafts = vers.filter((v) => v.learnerAvailability !== 'published_practice');
    if (pubs.length && drafts.length) supersededUnpublished += drafts.length;
  }

  const topicRows = [];
  const allTopics = new Set([...byTopic.keys(), ...topicPub.keys()]);
  for (const t of [...allTopics].sort()) {
    const batchN = (byTopic.get(t) || []).length;
    const pubLogical = topicPub.get(t) || [];
    const atlasTopic = allAi.filter((q) => q.topicId === t);
    topicRows.push({
      topicId: t,
      batch_questions: batchN,
      atlas_rows: atlasTopic.length,
      published_rows: atlasTopic.filter((q) => q.learnerAvailability === 'published_practice').length,
      published_distinct_logical: pubLogical.length,
      deficit_vs_12: Math.max(0, 12 - pubLogical.length),
      meets_12: pubLogical.length >= 12,
    });
  }

  const deficitTopics = topicRows.filter((r) => !r.meets_12);
  const report = {
    generated_at_utc: new Date().toISOString(),
    mongo: {
      source: config.mongoUriSource,
      isAtlas: config.mongoIdentity.isAtlas,
      database: config.mongoIdentity.database,
      hostHint: config.mongoIdentity.hostHint,
    },
    quality_report_claims: {
      eligible_questions_after_repair: quality.eligible_questions_after_repair,
      topics_with_ge_12_questions: quality.topics_with_ge_12_questions,
    },
    batch_file: {
      path: BATCH,
      n_questions: batchQs.length,
      n_resources: batchRs.length,
      unique_questionId_version: byId.size,
      duplicate_keys_in_batch: dupKeys,
      n_topics: byTopic.size,
    },
    atlas: {
      n_ai_question_rows: allAi.length,
      n_unique_logical_questionIds: versionsById.size,
      n_multi_version_logical: multiVersionLogical,
      n_published_rows: published.length,
      n_published_distinct_logical: publishedByLogical.size,
      n_draft_rows: draft.length,
      n_withdrawn_rows: withdrawn.length,
      n_validation_passed: passed.length,
      n_validation_failed: failed.length,
      n_superseded_unpublished_rows: supersededUnpublished,
      n_ai_resources: allAiR.length,
      n_published_resources: allAiR.filter((r) => r.learnerAvailability === 'published_practice').length,
    },
    reconciliation_531_vs_486: {
      explanation:
        'Prior "531 eligible questions" conflated import nAccepted (questions+resources) or package-sum with published logical count. ' +
        'Current batch file question count and Atlas published distinct logical IDs are the authoritative published figures.',
      batch_questions: batchQs.length,
      batch_resources: batchRs.length,
      batch_questions_plus_resources: batchQs.length + batchRs.length,
      atlas_published_distinct_logical: publishedByLogical.size,
      atlas_published_rows: published.length,
      batch_missing_in_atlas: batchMissingInAtlas.length,
      batch_present_not_published: batchPresentNotPublished.length,
      published_not_in_batch: publishedNotInBatch.length,
    },
    batch_missing_in_atlas: batchMissingInAtlas.slice(0, 50),
    batch_present_not_published_sample: batchPresentNotPublished.slice(0, 50),
    published_not_in_batch_sample: publishedNotInBatch.slice(0, 20).map((q) => ({
      questionId: q.questionId,
      version: q.version,
      topicId: q.topicId,
    })),
    topics_meeting_12: topicRows.filter((r) => r.meets_12).length,
    topics_below_12: deficitTopics.length,
    total_deficit_slots: deficitTopics.reduce((a, r) => a + r.deficit_vs_12, 0),
    deficit_topics: deficitTopics,
    topic_rows: topicRows,
    package_stats_summary: {
      n_packages: packageStats.length,
      packages_below_12: packageStats.filter((p) => p.n_package_questions < 12).length,
      quarantine_total: packageStats.reduce((a, p) => a + p.n_quarantine_file, 0),
    },
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        out: OUT,
        batch_q: batchQs.length,
        batch_r: batchRs.length,
        atlas_published_logical: publishedByLogical.size,
        topics_ge_12: report.topics_meeting_12,
        topics_below_12: report.topics_below_12,
        deficit_slots: report.total_deficit_slots,
        batch_missing: batchMissingInAtlas.length,
        batch_unpublished: batchPresentNotPublished.length,
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
