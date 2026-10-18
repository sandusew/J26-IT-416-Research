/**
 * Import AI-authored practice batch and publish-practice (not teacher approval).
 * Uses configured Mongo (Atlas via .env). No silent memory-server fallback.
 *
 * Usage (from backend/api):
 *   node scripts/import_and_publish_practice.js
 *   node scripts/import_and_publish_practice.js --dry-run
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const config = require('../src/config');
const { redactMongoUri } = require('../src/services/mongoSafe');
const {
  importBatch,
  publishPracticeQuestion,
  publishPracticeResource,
  coverageCounts,
} = require('../src/services/catalogueService');

const BATCH = path.join(
  __dirname,
  '..',
  '..',
  'ml',
  'data',
  'arts_content',
  'practice',
  'batches',
  'combined_import_batch.json'
);

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!fs.existsSync(BATCH)) {
    console.error('missing_batch', BATCH);
    process.exit(1);
  }
  const batch = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
  console.log(
    'connecting',
    JSON.stringify({
      source: config.mongoUriSource,
      isAtlas: config.mongoIdentity.isAtlas,
      database: config.mongoIdentity.database,
      hostHint: config.mongoIdentity.hostHint,
      redactedUri: redactMongoUri(config.mongoUri),
    })
  );
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 25000 });
  } catch (e) {
    console.error('mongo_connect_failed', e.message);
    console.error('No silent fallback — fix MONGODB_URI in backend/api/.env');
    process.exit(1);
  }
  const report = await importBatch({
    questions: batch.questions || [],
    resources: batch.resources || [],
    dryRun,
    atomic: false,
  });
  console.log(
    JSON.stringify(
      {
        dryRun,
        nAccepted: report.nAccepted,
        nRejected: report.nRejected,
        rejectedSample: (report.rejected || []).slice(0, 8),
      },
      null,
      2
    )
  );
  if (dryRun) {
    await mongoose.disconnect();
    return;
  }
  const actor = 'local_content_publish_cli';
  const { CanonicalQuestion, CanonicalResource } = require('../src/models/Catalogue');
  const qs = await CanonicalQuestion.find({
    isTestFixture: { $ne: true },
    automatedValidation: 'passed',
    learnerAvailability: { $ne: 'published_practice' },
    contentOrigin: 'ai_authored_source_grounded',
  }).lean();
  const rs = await CanonicalResource.find({
    isTestFixture: { $ne: true },
    automatedValidation: 'passed',
    learnerAvailability: { $ne: 'published_practice' },
    contentOrigin: 'ai_authored_source_grounded',
  }).lean();
  let nPub = 0;
  let nFail = 0;
  for (const q of qs) {
    const out = await publishPracticeQuestion(q.questionId, q.version, actor, q.contentHash);
    if (out.ok) nPub += 1;
    else nFail += 1;
  }
  for (const r of rs) {
    const out = await publishPracticeResource(r.resourceId, r.version, actor, r.contentHash);
    if (out.ok) nPub += 1;
    else nFail += 1;
  }
  const coverage = await coverageCounts();
  const outPath = path.join(__dirname, '..', 'reports', 'practice_import_publish.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const evidence = {
    generated_at_utc: new Date().toISOString(),
    import: { nAccepted: report.nAccepted, nRejected: report.nRejected },
    published: nPub,
    publishFailed: nFail,
    coverage,
    mongo: {
      source: config.mongoUriSource,
      isAtlas: config.mongoIdentity.isAtlas,
      database: config.mongoIdentity.database,
      hostHint: config.mongoIdentity.hostHint,
    },
    note: 'Practice publication ≠ teacher approval / authentic approved counts',
  };
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
