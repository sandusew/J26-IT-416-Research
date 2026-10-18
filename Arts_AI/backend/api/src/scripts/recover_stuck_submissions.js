/**
 * Recover expired submitting quiz assignments from durable pendingResponses.
 * Does NOT blindly reset submitting → assigned.
 *
 * Usage (from backend/api):
 *   node src/scripts/recover_stuck_submissions.js
 *   node src/scripts/recover_stuck_submissions.js --dry-run
 */
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');
const { recoverStuckSubmissions } = require('../services/quizSubmission');
const { QuizAssignment } = require('../models/Catalogue');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(config.mongoUri);
  const now = new Date();
  const stuck = await QuizAssignment.find({
    status: 'submitting',
    $or: [{ submissionLeaseUntil: null }, { submissionLeaseUntil: { $lte: now } }],
  }).lean();
  console.log(
    JSON.stringify(
      {
        dryRun,
        nStuck: stuck.length,
        ids: stuck.map((s) => s.assignmentId),
      },
      null,
      2
    )
  );
  if (dryRun) {
    await mongoose.disconnect();
    return;
  }
  const report = await recoverStuckSubmissions({ limit: 200 });
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
