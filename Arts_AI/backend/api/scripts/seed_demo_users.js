/**
 * Idempotent demo user ensure — does NOT reset existing passwords or delete users.
 * Usage: node scripts/seed_demo_users.js
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const { redactMongoUri } = require('../src/services/mongoSafe');

const USERS = [
  {
    username: 'demo_stu',
    role: 'student',
    displayName: 'Demo Student',
    studentId: 'demo_s0001',
  },
  {
    username: 'demo_tea',
    role: 'teacher',
    displayName: 'Demo Teacher',
    teacherId: 'demo_t0001',
  },
  { username: 'demo_admin', role: 'admin', displayName: 'Demo Admin' },
  { username: 'stu', role: 'student', displayName: 'S', studentId: 'syn_s0000' },
  { username: 'tea', role: 'teacher', displayName: 'T', teacherId: 'syn_t000' },
  { username: 'admin', role: 'admin', displayName: 'A' },
];

async function main() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 20000 });
  const User = require('../src/models/User');
  const created = [];
  const skipped = [];
  for (const u of USERS) {
    const existing = await User.findOne({ username: u.username }).lean();
    if (existing) {
      skipped.push(u.username);
      continue;
    }
    await User.create({
      ...u,
      passwordHash: await bcrypt.hash('pw', 4),
      isSyntheticFixture: true,
    });
    created.push(u.username);
  }
  console.log(
    JSON.stringify(
      {
        created,
        skippedExisting: skipped,
        note: 'Existing users preserved (passwords not reset)',
        mongo: {
          source: config.mongoUriSource,
          isAtlas: config.mongoIdentity.isAtlas,
          database: config.mongoIdentity.database,
          hostHint: config.mongoIdentity.hostHint,
          redactedUri: redactMongoUri(config.mongoUri),
        },
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
