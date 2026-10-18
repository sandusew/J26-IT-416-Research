const express = require('express');
const mongoose = require('mongoose');
const config = require('../config');
const { mlFetch } = require('../services/mlClient');
const meetingProvider = require('../services/meetingProvider');
const { redactMongoUri } = require('../services/mongoSafe');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'arts_ai_api' });
});

router.get('/ready', async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  let ml = { ready: false, missing: ['ml_inference_service'] };
  try {
    ml = await mlFetch('/ready');
  } catch (e) {
    ml = { ready: false, missing: ['ml_inference_service'], error: e.message };
  }
  const meeting = meetingProvider.readiness();
  const ready = mongoOk && ml.ready;
  res.status(ready ? 200 : 503).json({
    ready,
    mongodb: mongoOk ? 'up' : 'down',
    mongodb_identity: {
      source: config.mongoUriSource,
      isAtlas: config.mongoIdentity.isAtlas,
      database: config.mongoIdentity.database,
      hostHint: config.mongoIdentity.hostHint,
      redactedUri: redactMongoUri(config.mongoUri),
    },
    content_policy_default: config.contentPolicy,
    ml,
    meeting_integration: meeting,
    recommendation_policy_default: config.recommendationPolicy,
  });
});

module.exports = router;
