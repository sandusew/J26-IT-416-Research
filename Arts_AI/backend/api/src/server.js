const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');
const config = require('./config');
const { redactMongoUri } = require('./services/mongoSafe');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const mlRoutes = require('./routes/ml');
const consultationRoutes = require('./routes/consultations');
const learningRoutes = require('./routes/learning');
const catalogueRoutes = require('./routes/catalogue');

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan('dev'));

  app.use(healthRoutes);
  app.use('/auth', authRoutes);
  app.use('/ml', mlRoutes);
  app.use('/consultations', consultationRoutes);
  app.use('/learning', learningRoutes);
  app.use('/catalogue', catalogueRoutes);

  app.use((err, _req, res, _next) => {
    const status = Number(err.status || err.statusCode) || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status === 400 ? 'invalid_json' : 'internal_error' });
  });

  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 20000 });
  } catch (e) {
    console.error(
      'MongoDB connection failed — refusing to start API with persistence disabled:',
      e.message
    );
    console.error(
      'Safe connection identity:',
      JSON.stringify({
        source: config.mongoUriSource,
        ...config.mongoIdentity,
        redactedUri: redactMongoUri(config.mongoUri),
      })
    );
    process.exit(1);
  }

  console.log(
    'MongoDB connected:',
    JSON.stringify({
      source: config.mongoUriSource,
      isAtlas: config.mongoIdentity.isAtlas,
      database: config.mongoIdentity.database,
      hostHint: config.mongoIdentity.hostHint,
      redactedUri: redactMongoUri(config.mongoUri),
    })
  );

  app.listen(config.port, () => {
    console.log(`Arts AI API listening on :${config.port}`);
    console.log(`ML inference expected at ${config.mlInferenceUrl}`);
    console.log(`Meeting integration: ${config.meetingIntegration}`);
    console.log(`Content policy default: ${config.contentPolicy}`);
  });
}

main();
