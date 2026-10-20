const express = require('express');
const { authRequired, requireOwnership, requireRole } = require('../middleware/auth');
const { mlFetch } = require('../services/mlClient');
const DigitalTwinProfile = require('../models/DigitalTwinProfile');
const { syncObservedTwinFromAttempts } = require('../services/quizSubmission');
const ChatInteraction = require('../models/ChatInteraction');
const { resolveFixtureAccess } = require('../services/fixturePolicy');

const router = express.Router();

/** Model Explorer / staff diagnostic — does not auto-write learner Twin profiles. */
function staffOrAdmin(req, res, next) {
  return requireRole('teacher', 'admin')(req, res, next);
}

router.get('/ready', authRequired, async (_req, res) => {
  try {
    const ready = await mlFetch('/ready');
    return res.json(ready);
  } catch (e) {
    return res.status(503).json({
      ready: false,
      missing: ['ml_inference_service'],
      error: e.message,
    });
  }
});

router.post('/behaviour/cluster', authRequired, staffOrAdmin, async (req, res) => {
  try {
    const out = await mlFetch('/v1/behaviour/cluster', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    return res.json(out);
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message, detail: e.body });
  }
});

router.post(
  '/digital-twin/:studentId/update',
  authRequired,
  requireOwnership('studentId'),
  async (req, res) => {
    try {
      const out = await mlFetch('/v1/digital-twin/update', {
        method: 'POST',
        body: JSON.stringify({
          student_id: req.params.studentId,
          events: req.body.events || [],
          observation_window_days: req.body.observation_window_days || 14,
          data_category: req.body.data_category || 'synthetic_learner',
        }),
      });
      const doc = await syncObservedTwinFromAttempts(req.params.studentId, {
        source: 'ml_digital_twin_update',
        ml_digital_twin: out,
      });
      return res.json({ ...out, storedProfileVersion: doc.profileVersion });
    } catch (e) {
      return res.status(e.status || 502).json({ error: e.message, detail: e.body });
    }
  }
);

router.post('/risk/predict', authRequired, staffOrAdmin, async (req, res) => {
  try {
    const out = await mlFetch('/v1/risk/predict', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    return res.json(out);
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message, detail: e.body });
  }
});

router.post(
  '/chat/:studentId/ask',
  authRequired,
  requireOwnership('studentId'),
  async (req, res) => {
    try {
      const requestedMode = String(req.body.corpus_mode || 'domain').toLowerCase();
      const wantsFixture =
        requestedMode === 'fixture' ||
        requestedMode === 'generated' ||
        req.body.allowChatFixtures === true;
      const fixtureAccess = resolveFixtureAccess(wantsFixture);
      if (wantsFixture && !fixtureAccess.allowed) {
        return res.status(403).json({
          error: 'fixtures_not_enabled',
          reason: fixtureAccess.reason,
          note: 'Default chat corpus is domain; fixture requires ARTS_AI_ALLOW_TEST_FIXTURES on API and ML',
        });
      }
      const question = String(req.body.question || '').trim();
      if (!question) return res.status(400).json({ error: 'question_required' });
      if (question.length > 2000) return res.status(400).json({ error: 'question_too_long' });
      const corpusMode = wantsFixture && fixtureAccess.allowed ? 'fixture' : 'domain';

      // Authentic Twin context only — never fixture weak_topics for domain chat personalization
      let twin = null;
      if (req.body.includeDigitalTwin) {
        const latest = await DigitalTwinProfile.findOne({ studentId: req.params.studentId })
          .sort({ createdAt: -1 })
          .lean();
        if (latest) {
          twin = {
            cluster_id: latest.payload?.cluster_id,
            risk_band: latest.payload?.risk_band || latest.payload?.policy_band,
            // Prefer authentic server aggregates
            weak_topics: latest.payload?.weak_topics || [],
            observed_topic_performance: latest.payload?.observed_topic_performance || {},
            profile_version: latest.profileVersion,
            data_category: latest.dataCategory || latest.payload?.data_category,
          };
          // Strip fixture performance from twin sent to ML for domain mode
          if (corpusMode === 'domain') {
            delete twin.observed_topic_performance_fixture;
            if (twin.data_category === 'test_fixture_learner') {
              twin.weak_topics = [];
              twin.personalization_note = 'fixture_twin_excluded_from_domain_personalization';
            }
          }
        }
      }

      // Do not mix fixture conversation history into domain turns
      let history;
      if (Array.isArray(req.body.conversation_history)) {
        history = req.body.conversation_history
          .filter((t) => {
            if (corpusMode === 'domain' && t && t.corpus_mode === 'fixture') return false;
            return true;
          })
          .slice(-4)
          .map((t) => ({
            role: t.role || t.speaker || 'user',
            content: String(t.content || t.text || t.question || '').slice(0, 400),
            corpus_mode: t.corpus_mode || null,
          }));
      }

      const out = await mlFetch('/v1/chat/ask', {
        method: 'POST',
        body: JSON.stringify({
          student_id: req.params.studentId,
          question,
          digital_twin: twin,
          conversation_history: history,
          use_generation: req.body.use_generation === true,
          corpus_mode: corpusMode,
          allow_chat_fixtures: fixtureAccess.allowed && wantsFixture,
          subject_id: req.body.subject_id || req.body.subjectId || null,
          language: req.body.language || null,
        }),
      });
      if (corpusMode === 'domain' && out.corpus_mode && out.corpus_mode !== 'domain') {
        return res.status(502).json({
          error: 'unexpected_corpus_mode',
          note: 'Domain chat did not stay on the domain corpus',
        });
      }
      await ChatInteraction.create({
        interactionId: out.interaction_id || `chat_${Date.now()}`,
        studentId: req.params.studentId,
        question,
        answer: out.answer,
        citations: out.citations || [],
        modelVersion: out.model_version,
        insufficientEvidence: !!out.insufficient_evidence,
        corpusMode: out.corpus_mode || corpusMode,
        corpusVersion: out.corpus_version || null,
        timestamp: new Date(),
      });
      return res.json(out);
    } catch (e) {
      return res.status(e.status || 502).json({ error: e.message, detail: e.body });
    }
  }
);

/** EdNet correctness — Model Explorer (staff). Body passthrough to FastAPI. */
router.post('/correctness/predict', authRequired, staffOrAdmin, async (req, res) => {
  try {
    const out = await mlFetch('/v1/correctness/predict', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    return res.json(out);
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message, detail: e.body });
  }
});

/** Closed-set NL topic classify — Model Explorer (staff). */
router.post('/topic/classify', authRequired, staffOrAdmin, async (req, res) => {
  try {
    const out = await mlFetch('/v1/topic/classify', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    return res.json(out);
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message, detail: e.body });
  }
});

/**
 * Pointwise ranker score — Model Explorer diagnostic only.
 * Default learner recommendations remain GET /learning/recommendations (prerequisite_aware).
 */
router.post('/recommendations/score', authRequired, staffOrAdmin, async (req, res) => {
  try {
    const out = await mlFetch('/v1/recommendations/score', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    return res.json(out);
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message, detail: e.body });
  }
});

module.exports = router;
