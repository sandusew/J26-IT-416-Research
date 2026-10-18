/**
 * Safely republish repaired practice content to configured Mongo (Atlas).
 * Only publishes question/resource IDs present in the repaired combined batch.
 * Superseded AI practice not in the batch is left unpublished (draft) for history.
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
  if (!fs.existsSync(BATCH)) {
    console.error('missing_batch', BATCH);
    process.exit(1);
  }
  const batch = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
  const eligibleQ = new Set(
    (batch.questions || []).map((q) => `${q.questionId}::${String(q.version || '1')}`)
  );
  const eligibleR = new Set(
    (batch.resources || []).map((r) => `${r.resourceId}::${String(r.version || '1')}`)
  );

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

  const publishedQ = await CanonicalQuestion.find({
    contentOrigin: 'ai_authored_source_grounded',
    learnerAvailability: 'published_practice',
    isTestFixture: { $ne: true },
  }).lean();
  const publishedR = await CanonicalResource.find({
    contentOrigin: 'ai_authored_source_grounded',
    learnerAvailability: 'published_practice',
    isTestFixture: { $ne: true },
  }).lean();

  const exportDir = path.join(__dirname, '..', 'reports', 'exports');
  fs.mkdirSync(exportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const exportPath = path.join(exportDir, `published_practice_before_republish_${stamp}.json`);
  fs.writeFileSync(
    exportPath,
    JSON.stringify(
      {
        exported_at_utc: new Date().toISOString(),
        database: config.mongoIdentity.database,
        hostHint: config.mongoIdentity.hostHint,
        n_questions: publishedQ.length,
        n_resources: publishedR.length,
        questions: publishedQ.map((q) => ({
          questionId: q.questionId,
          version: q.version,
          topicId: q.topicId,
          contentHash: q.contentHash,
          publishedContentHash: q.publishedContentHash,
        })),
        resources: publishedR.map((r) => ({
          resourceId: r.resourceId,
          version: r.version,
          contentHash: r.contentHash,
        })),
      },
      null,
      2
    )
  );

  // Withdraw ALL currently published AI practice from new assignments
  const wq = await CanonicalQuestion.updateMany(
    {
      contentOrigin: 'ai_authored_source_grounded',
      learnerAvailability: 'published_practice',
      isTestFixture: { $ne: true },
    },
    {
      $set: {
        learnerAvailability: 'draft',
        publishedAt: null,
        publishedBy: null,
        publishedContentHash: null,
      },
    }
  );
  const wr = await CanonicalResource.updateMany(
    {
      contentOrigin: 'ai_authored_source_grounded',
      learnerAvailability: 'published_practice',
      isTestFixture: { $ne: true },
    },
    {
      $set: {
        learnerAvailability: 'draft',
        publishedAt: null,
        publishedBy: null,
        publishedContentHash: null,
      },
    }
  );

  const report = await importBatch({
    questions: batch.questions || [],
    resources: batch.resources || [],
    dryRun: false,
    atomic: false,
  });

  const actor = 'repair_republish_cli';
  let nPub = 0;
  let nFail = 0;
  let nSkippedNotInBatch = 0;

  // Publish only batch-eligible rows
  for (const key of eligibleQ) {
    const [questionId, version] = key.split('::');
    const doc = await CanonicalQuestion.findOne({ questionId, version }).lean();
    if (!doc || doc.automatedValidation !== 'passed' || doc.isTestFixture) {
      nFail += 1;
      continue;
    }
    const out = await publishPracticeQuestion(questionId, version, actor, doc.contentHash);
    if (out.ok) nPub += 1;
    else nFail += 1;
  }
  for (const key of eligibleR) {
    const [resourceId, version] = key.split('::');
    const doc = await CanonicalResource.findOne({ resourceId, version }).lean();
    if (!doc || doc.automatedValidation !== 'passed' || doc.isTestFixture) {
      nFail += 1;
      continue;
    }
    const out = await publishPracticeResource(resourceId, version, actor, doc.contentHash);
    if (out.ok) nPub += 1;
    else nFail += 1;
  }

  // Count any stray published AI practice not in batch (should be 0)
  const stray = await CanonicalQuestion.countDocuments({
    contentOrigin: 'ai_authored_source_grounded',
    learnerAvailability: 'published_practice',
    isTestFixture: { $ne: true },
  });
  const publishedNow = await CanonicalQuestion.find({
    contentOrigin: 'ai_authored_source_grounded',
    learnerAvailability: 'published_practice',
    isTestFixture: { $ne: true },
  }).lean();
  for (const q of publishedNow) {
    const key = `${q.questionId}::${String(q.version)}`;
    if (!eligibleQ.has(key)) {
      nSkippedNotInBatch += 1;
      await CanonicalQuestion.updateOne(
        { _id: q._id },
        {
          $set: {
            learnerAvailability: 'draft',
            publishedAt: null,
            publishedBy: null,
            publishedContentHash: null,
          },
        }
      );
    }
  }

  const coverage = await coverageCounts();
  const evidence = {
    generated_at_utc: new Date().toISOString(),
    exportPath,
    withdrawn: { questions: wq.modifiedCount, resources: wr.modifiedCount },
    import: { nAccepted: report.nAccepted, nRejected: report.nRejected },
    batchEligibleQuestions: eligibleQ.size,
    batchEligibleResources: eligibleR.size,
    published: nPub,
    publishFailed: nFail,
    strayUnpublished: nSkippedNotInBatch,
    strayCheckBeforeCleanup: stray,
    coverage,
    mongo: {
      source: config.mongoUriSource,
      isAtlas: config.mongoIdentity.isAtlas,
      database: config.mongoIdentity.database,
      hostHint: config.mongoIdentity.hostHint,
    },
    note: 'Only repaired batch items published; superseded drafts retained for history/frozen assigns',
  };
  const outPath = path.join(__dirname, '..', 'reports', 'practice_republish.json');
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
