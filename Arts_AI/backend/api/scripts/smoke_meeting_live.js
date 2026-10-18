/**
 * Live meeting provider smoke.
 * Requires --live and real MEETING_* credentials.
 * Uses MEETING_SMOKE_RUN=1 so createMeeting can run without prior smoke JSON
 * (breaks circular readiness dependency without weakening normal readiness).
 *
 * Usage (from backend/api):
 *   node scripts/smoke_meeting_live.js
 *   node scripts/smoke_meeting_live.js --live
 */
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createMeeting, cancelMeeting, readiness } = require('../src/services/meetingProvider');

const REPORTS = path.join(__dirname, '..', 'reports');

function configIdentity() {
  const provider = (process.env.MEETING_PROVIDER || '').trim().toLowerCase();
  const base = process.env.MEETING_API_BASE || '';
  const keyPresent = Boolean(process.env.MEETING_API_KEY || process.env.MEETING_CLIENT_SECRET);
  const fp = crypto
    .createHash('sha256')
    .update(`${provider}|${base}|${keyPresent}|${process.env.MEETING_INTEGRATION || ''}`)
    .digest('hex')
    .slice(0, 16);
  return {
    provider: provider || null,
    api_base_configured: Boolean(base),
    api_key_present: keyPresent,
    integration_flag: process.env.MEETING_INTEGRATION || 'unconfigured',
    config_fingerprint: fp,
  };
}

async function main() {
  const live = process.argv.includes('--live');
  fs.mkdirSync(REPORTS, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const outPath = path.join(REPORTS, `meeting_live_smoke_${ts}.json`);
  const cfg = configIdentity();
  const evidence = {
    generated_at_utc: new Date().toISOString(),
    live_requested: live,
    config: cfg,
    checks: [],
    outcome: null,
  };

  if (!live) {
    evidence.outcome = 'blocked_missing_configuration';
    evidence.blocker = 'pass --live to run; dry inspection only';
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ wrote: outPath, outcome: evidence.outcome }, null, 2));
    process.exit(2);
  }

  if (
    cfg.integration_flag !== 'configured' ||
    !cfg.provider ||
    !cfg.api_base_configured ||
    !cfg.api_key_present
  ) {
    evidence.outcome = 'blocked_missing_configuration';
    evidence.blocker =
      'Require MEETING_INTEGRATION=configured, MEETING_PROVIDER, MEETING_API_BASE, MEETING_API_KEY';
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ wrote: outPath, outcome: evidence.outcome }, null, 2));
    process.exit(2);
  }

  // Restricted smoke path — allows provider call without prior smoke JSON
  process.env.MEETING_SMOKE_RUN = '1';

  const consultationId = `smoke_consult_${Date.now()}`;
  const start = new Date(Date.now() + 3600_000);
  const end = new Date(Date.now() + 5400_000);
  const payload = {
    consultationId,
    teacherId: 'syn_t000',
    studentId: 'syn_s0000',
    start,
    end,
    subjectId: 'sub_history',
  };

  const first = await createMeeting(payload);
  evidence.checks.push({
    name: 'create_meeting',
    ok: first.ok,
    provider: first.provider,
    meetingUrlPresent: Boolean(first.meetingUrl),
    providerMeetingId: first.providerMeetingId || null,
    error: first.error || null,
  });

  const second = await createMeeting(payload);
  evidence.checks.push({
    name: 'idempotent_recreate',
    ok: second.ok,
    sameMeetingId:
      first.providerMeetingId && second.providerMeetingId
        ? first.providerMeetingId === second.providerMeetingId
        : null,
    error: second.error || null,
  });

  let cleanup = null;
  if (typeof cancelMeeting === 'function' && first.providerMeetingId) {
    try {
      cleanup = await cancelMeeting({
        providerMeetingId: first.providerMeetingId,
        consultationId,
      });
      evidence.checks.push({ name: 'cleanup_cancel', result: cleanup });
    } catch (e) {
      evidence.checks.push({
        name: 'cleanup_cancel',
        error: String(e.message || e),
        note: 'Cleanup failure recorded; not treated as create success',
      });
    }
  }

  const passed =
    first.ok &&
    first.meetingUrl &&
    first.providerMeetingId &&
    second.ok;

  if (passed) {
    evidence.outcome = 'passed';
    const smokePath = path.join(REPORTS, 'meeting_smoke_test.json');
    // Preserve prior successful smoke if fingerprint differs
    if (fs.existsSync(smokePath)) {
      const prior = JSON.parse(fs.readFileSync(smokePath, 'utf8'));
      if (prior.config_fingerprint && prior.config_fingerprint !== cfg.config_fingerprint) {
        const archive = path.join(
          REPORTS,
          `meeting_smoke_test__${prior.config_fingerprint}.json`
        );
        fs.copyFileSync(smokePath, archive);
      }
    }
    fs.writeFileSync(
      smokePath,
      JSON.stringify(
        {
          generated_at_utc: evidence.generated_at_utc,
          provider: cfg.provider,
          config_fingerprint: cfg.config_fingerprint,
          consultationId,
          providerMeetingId: first.providerMeetingId,
          meetingUrl_redacted: true,
          smoke_script: 'scripts/smoke_meeting_live.js',
          passed: true,
        },
        null,
        2
      )
    );
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ wrote: outPath, outcome: 'passed', smokePath }, null, 2));
    process.exit(0);
  }

  evidence.outcome = 'failed';
  evidence.readiness_snapshot = readiness();
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ wrote: outPath, outcome: 'failed' }, null, 2));
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
