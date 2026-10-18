# Meeting integration

## Status

**Provider-neutral adapter implemented** (`backend/api/src/services/meetingProvider.js`).

Consultation approve calls `createMeeting` (idempotent if `providerMeetingId` already set). On failure `meetingUrl` stays **null**.

**Live smoke not executed** — no provider credentials. Readiness remains unconfigured until smoke evidence exists.

`http_webhook` is **not** Zoom or Google Meet. It requires a real service that implements the contract below.

## Provider decision (remaining)

Choose one:

1. Deploy/configure a webhook meeting service that implements this contract, set `MEETING_PROVIDER=http_webhook`, or
2. Implement a dedicated Zoom/Meet adapter (not shipped) after selecting that product.

## `http_webhook` contract

### Create

`POST {MEETING_API_BASE}/meetings`

Headers: `Authorization: Bearer {MEETING_API_KEY}`, `Content-Type: application/json`

Request body:

```json
{
  "consultationId": "con_…",
  "teacherId": "…",
  "studentId": "…",
  "start": "ISO-8601",
  "end": "ISO-8601",
  "subjectId": "…",
  "timezone": "Asia/Colombo"
}
```

Required response fields (any alias set):

- Join URL: `joinUrl` | `meetingUrl` | `url`
- Provider id: `id` | `meetingId`

### Cancel

`DELETE {MEETING_API_BASE}/meetings/{providerMeetingId}`

## Configuration

| Variable | Purpose |
|----------|---------|
| `MEETING_PROVIDER` | `http_webhook` when using this adapter |
| `MEETING_INTEGRATION` | `configured` only when wiring a real provider |
| `MEETING_API_BASE` | Provider HTTP base URL |
| `MEETING_API_KEY` | Bearer token (server-side only) |
| `MEETING_TIMEOUT_MS` | Default 15000 |
| `MEETING_TIMEZONE` | Default `Asia/Colombo` |

`MEETING_PROVIDER_TESTED=true` alone is **insufficient**.

## Smoke evidence

Write `backend/api/reports/meeting_smoke_test.json` **only after** a real provider call via `writeSmokeTestRecord`. Until `result=pass`, `/ready` reports meeting as unconfigured.

## Offline tests

```powershell
cd <repo>\backend\api
node --test tests\meeting_provider_contract.test.js
```
