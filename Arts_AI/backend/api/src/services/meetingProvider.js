/**
 * Meeting provider adapters for consultation approval.
 * Never fabricate join URLs. Env flags alone ≠ verified integration.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function configFingerprint(provider) {
  const base = process.env.MEETING_API_BASE || '';
  return crypto
    .createHash('sha256')
    .update(`${provider}|${base}|${process.env.MEETING_INTEGRATION || ''}`)
    .digest('hex')
    .slice(0, 16);
}

function getProviderName() {
  return (process.env.MEETING_PROVIDER || '').trim().toLowerCase();
}

function isConfigured() {
  const provider = getProviderName();
  const flag = (process.env.MEETING_INTEGRATION || '').toLowerCase() === 'configured';
  const key = process.env.MEETING_API_KEY || process.env.MEETING_CLIENT_SECRET || '';
  return Boolean(provider && flag && key);
}

/** Explicit smoke-script path — does not weaken normal readiness (still needs credentials). */
function isSmokeRun() {
  return String(process.env.MEETING_SMOKE_RUN || '').toLowerCase() === '1';
}

/**
 * Create a meeting for an approved consultation.
 * Returns { ok, meetingUrl, providerMeetingId, error, provider }
 */
async function createMeeting({ consultationId, teacherId, studentId, start, end, subjectId }) {
  const provider = getProviderName();
  if (!provider) {
    return {
      ok: false,
      meetingUrl: null,
      providerMeetingId: null,
      provider: null,
      error: 'meeting_provider_not_selected',
    };
  }
  if (!isConfigured()) {
    return {
      ok: false,
      meetingUrl: null,
      providerMeetingId: null,
      provider,
      error: 'meeting_provider_credentials_or_flag_missing',
    };
  }

  if (provider === 'http_webhook') {
    // Generic HTTP meeting create — POST JSON to MEETING_API_BASE
    const base = (process.env.MEETING_API_BASE || '').replace(/\/$/, '');
    if (!base) {
      return { ok: false, meetingUrl: null, providerMeetingId: null, provider, error: 'MEETING_API_BASE_required' };
    }
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), Number(process.env.MEETING_TIMEOUT_MS || 15000));
    try {
      const res = await fetch(`${base}/meetings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.MEETING_API_KEY}`,
        },
        body: JSON.stringify({
          consultationId,
          teacherId,
          // Minimize PII: student id only if required by contract
          studentId,
          start: start instanceof Date ? start.toISOString() : start,
          end: end instanceof Date ? end.toISOString() : end,
          subjectId,
          timezone: process.env.MEETING_TIMEZONE || 'Asia/Colombo',
        }),
        signal: controller.signal,
      });
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
      if (!res.ok) {
        return {
          ok: false,
          meetingUrl: null,
          providerMeetingId: null,
          provider,
          error: `provider_http_${res.status}`,
          detail: body.error || body.message || null,
        };
      }
      const meetingUrl = body.joinUrl || body.meetingUrl || body.url || null;
      const providerMeetingId = body.id || body.meetingId || null;
      if (!meetingUrl || !providerMeetingId) {
        return {
          ok: false,
          meetingUrl: null,
          providerMeetingId: null,
          provider,
          error: 'provider_response_missing_url_or_id',
        };
      }
      return { ok: true, meetingUrl, providerMeetingId, provider };
    } catch (e) {
      return {
        ok: false,
        meetingUrl: null,
        providerMeetingId: null,
        provider,
        error: e.name === 'AbortError' ? 'provider_timeout' : `provider_error:${e.message}`,
      };
    } finally {
      clearTimeout(t);
    }
  }

  return {
    ok: false,
    meetingUrl: null,
    providerMeetingId: null,
    provider,
    error: `unsupported_meeting_provider:${provider}`,
    note: 'Select MEETING_PROVIDER=http_webhook with MEETING_API_BASE + MEETING_API_KEY, or implement a dedicated adapter',
  };
}

async function cancelMeeting(arg) {
  const providerMeetingId =
    typeof arg === 'string' ? arg : arg && arg.providerMeetingId;
  const provider = getProviderName();
  if (!provider || !providerMeetingId || (!isConfigured() && !isSmokeRun())) {
    return { ok: false, error: 'cancel_unavailable' };
  }
  if (provider === 'http_webhook') {
    const base = (process.env.MEETING_API_BASE || '').replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/meetings/${encodeURIComponent(providerMeetingId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${process.env.MEETING_API_KEY}` },
      });
      return { ok: res.ok || res.status === 404, status: res.status, provider };
    } catch (e) {
      return { ok: false, error: String(e.message || e), provider };
    }
  }
  return { ok: false, error: 'unsupported_provider_cancel' };
}

/**
 * Write smoke-test evidence ONLY after a real provider call.
 * Do not call this to fabricate verification.
 */
function writeSmokeTestRecord(record) {
  const dir = path.join(__dirname, '..', '..', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'meeting_smoke_test.json');
  const payload = {
    ...record,
    tested_at: record.tested_at || new Date().toISOString(),
    config_fingerprint: configFingerprint(record.provider || getProviderName()),
  };
  fs.writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');
  return out;
}

function readSmokeTestRecord() {
  const out = path.join(__dirname, '..', '..', 'reports', 'meeting_smoke_test.json');
  if (!fs.existsSync(out)) return null;
  try {
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  } catch {
    return null;
  }
}

function readiness() {
  const smoke = readSmokeTestRecord();
  const provider = getProviderName();
  const configured = isConfigured();
  const smokePass = smoke && smoke.result === 'pass';
  return {
    provider: provider || null,
    configured_flag: (process.env.MEETING_INTEGRATION || '') === 'configured',
    credentials_present: Boolean(process.env.MEETING_API_KEY || process.env.MEETING_CLIENT_SECRET),
    smoke_tested: Boolean(smokePass),
    smoke_path: smoke ? path.join('backend/api/reports/meeting_smoke_test.json') : null,
    status: configured && smokePass ? 'ready' : 'unconfigured',
    note: 'MEETING_PROVIDER_TESTED=true alone is insufficient; require smoke JSON from actual execution',
  };
}

module.exports = {
  createMeeting,
  cancelMeeting,
  writeSmokeTestRecord,
  readSmokeTestRecord,
  readiness,
  isConfigured,
  getProviderName,
  configFingerprint,
};
