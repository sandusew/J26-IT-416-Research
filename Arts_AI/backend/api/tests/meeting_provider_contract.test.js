/**
 * Provider-neutral meeting adapter contract tests (no live provider).
 * Run: node --test tests/meeting_provider_contract.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const meeting = require('../src/services/meetingProvider');

describe('meetingProvider contract (offline)', () => {
  it('returns not_selected when MEETING_PROVIDER unset', async () => {
    const prev = process.env.MEETING_PROVIDER;
    delete process.env.MEETING_PROVIDER;
    const r = await meeting.createMeeting({
      consultationId: 'con_test',
      teacherId: 't1',
      studentId: 's1',
      start: new Date().toISOString(),
      end: new Date(Date.now() + 3600000).toISOString(),
      subjectId: 'sub_history',
    });
    assert.equal(r.ok, false);
    assert.equal(r.meetingUrl, null);
    assert.equal(r.error, 'meeting_provider_not_selected');
    if (prev !== undefined) process.env.MEETING_PROVIDER = prev;
  });

  it('readiness is unconfigured without smoke JSON', () => {
    const r = meeting.readiness();
    assert.equal(r.status, 'unconfigured');
    assert.equal(r.smoke_tested, false);
  });

  it('config fingerprint is stable non-secret hash', () => {
    const fp = meeting.configFingerprint('http_webhook');
    assert.equal(typeof fp, 'string');
    assert.equal(fp.length, 16);
    assert.ok(!String(fp).includes('sk-'));
  });

  it('unsupported provider name fails without fabricating URL', async () => {
    const prevP = process.env.MEETING_PROVIDER;
    const prevI = process.env.MEETING_INTEGRATION;
    const prevK = process.env.MEETING_API_KEY;
    process.env.MEETING_PROVIDER = 'zoom_not_implemented';
    process.env.MEETING_INTEGRATION = 'configured';
    process.env.MEETING_API_KEY = 'test_key_not_real';
    const r = await meeting.createMeeting({
      consultationId: 'con_x',
      teacherId: 't1',
      studentId: 's1',
      start: '2026-06-01T10:00:00.000Z',
      end: '2026-06-01T10:30:00.000Z',
      subjectId: 'sub_history',
    });
    assert.equal(r.ok, false);
    assert.equal(r.meetingUrl, null);
    assert.match(r.error, /unsupported_meeting_provider/);
    process.env.MEETING_PROVIDER = prevP || '';
    process.env.MEETING_INTEGRATION = prevI || 'unconfigured';
    if (prevK === undefined) delete process.env.MEETING_API_KEY;
    else process.env.MEETING_API_KEY = prevK;
  });
});
