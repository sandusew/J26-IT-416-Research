/**
 * Seed synthetic demo fixture accounts — NOT real participants.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const config = require('../config');
const User = require('../models/User');

async function main() {
  await mongoose.connect(config.mongoUri);
  const fixtures = [
    {
      username: 'student_demo',
      password: 'demo_student',
      role: 'student',
      displayName: 'Demo Student',
      studentId: 'syn_s0000',
    },
    {
      username: 'teacher_demo',
      password: 'demo_teacher',
      role: 'teacher',
      displayName: 'Demo Teacher',
      teacherId: 'syn_t000',
    },
    {
      username: 'admin_demo',
      password: 'demo_admin',
      role: 'admin',
      displayName: 'Demo Admin',
    },
  ];
  for (const f of fixtures) {
    const passwordHash = await bcrypt.hash(f.password, 10);
    await User.findOneAndUpdate(
      { username: f.username },
      {
        username: f.username,
        passwordHash,
        role: f.role,
        displayName: f.displayName,
        studentId: f.studentId,
        teacherId: f.teacherId,
        isSyntheticFixture: true,
        dataOrigin: 'synthetic_operational',
      },
      { upsert: true, new: true }
    );
    console.log('Upserted fixture', f.username, '(synthetic — not a real participant)');
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
