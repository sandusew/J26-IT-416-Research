const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { mongoIdentity } = require('../services/mongoSafe');

// Load backend/api/.env explicitly (cwd-independent).
const envPath = path.join(__dirname, '..', '..', '.env');
const envExists = fs.existsSync(envPath);
const parsedEnv = envExists ? dotenv.parse(fs.readFileSync(envPath)) : {};

// Prefer .env MONGODB_URI over a stale shell override unless explicitly allowed.
const allowShellMongoOverride =
  String(process.env.ARTS_AI_MONGO_URI_SOURCE || '')
    .trim()
    .toLowerCase() === 'shell';

// Standard dotenv: do not override existing keys for most vars
dotenv.config({ path: envPath });

let mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/arts_ai';
let mongoUriSource = process.env.MONGODB_URI ? 'environment' : 'default_local';

if (parsedEnv.MONGODB_URI) {
  const shellUri = process.env.MONGODB_URI;
  if (!shellUri || shellUri === parsedEnv.MONGODB_URI) {
    mongoUri = parsedEnv.MONGODB_URI;
    process.env.MONGODB_URI = mongoUri;
    mongoUriSource = 'dotenv_file';
  } else if (allowShellMongoOverride) {
    mongoUri = shellUri;
    mongoUriSource = 'shell_override_explicit';
  } else {
    // Stale shell must not silently redirect away from configured Atlas/.env
    mongoUri = parsedEnv.MONGODB_URI;
    process.env.MONGODB_URI = mongoUri;
    mongoUriSource = 'dotenv_file_preferred_over_shell';
    const shellId = mongoIdentity(shellUri);
    const fileId = mongoIdentity(parsedEnv.MONGODB_URI);
    console.warn(
      '[config] Ignoring shell MONGODB_URI that differs from backend/api/.env',
      JSON.stringify({
        shell: { isAtlas: shellId.isAtlas, database: shellId.database, hostHint: shellId.hostHint },
        dotenv: { isAtlas: fileId.isAtlas, database: fileId.database, hostHint: fileId.hostHint },
        note: 'Set ARTS_AI_MONGO_URI_SOURCE=shell to force shell override',
      })
    );
  }
}

const nodeEnv = process.env.NODE_ENV || 'development';
const allowTestFixturesRaw = String(process.env.ARTS_AI_ALLOW_TEST_FIXTURES || '')
  .trim()
  .toLowerCase();
const allowTestFixtures =
  nodeEnv !== 'production' && ['1', 'true', 'yes'].includes(allowTestFixturesRaw);

const mongo = mongoIdentity(mongoUri);

module.exports = {
  port: Number(process.env.PORT || 4000),
  mongoUri,
  mongoUriSource,
  mongoIdentity: mongo,
  jwtSecret: process.env.JWT_SECRET || 'arts_ai_dev_secret_local_only',
  mlInferenceUrl:
    process.env.ML_INFERENCE_URL || process.env.ML_BASE_URL || 'http://127.0.0.1:8000',
  meetingIntegration: process.env.MEETING_INTEGRATION || 'unconfigured',
  recommendationPolicy: (process.env.RECOMMENDATION_POLICY || 'prerequisite_aware').trim(),
  contentPolicy: (process.env.ARTS_AI_CONTENT_POLICY || 'published_practice').trim(),
  nodeEnv,
  allowTestFixtures,
  envPath,
  envFilePresent: envExists,
};
