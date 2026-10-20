# Continuation report — 2026-10-14 fixture isolation & catalogue reliability

Supersedes `CONTINUATION_REPORT_20261014_CANONICAL_WORKFLOW.md` for remaining handoff. Prior evidence retained.

## Defects found and fixed

1. **Client `allowTestFixtures` / `includeFixtures` could enable fixtures alone** — now requires `ARTS_AI_ALLOW_TEST_FIXTURES=true` and `NODE_ENV≠production`, plus client opt-in. Production always rejects.
2. **Import could set `approved_for_learner` / forged `reviewerId`** — import forces draft; reviewer identity only from JWT on `/review`.
3. **Assign could select multiple versions of the same `questionId`** — now one eligible version per ID (prefer higher version).
4. **Concurrent submit race** — atomic `assigned → submitting → submitted` claim; unique `(assignmentId, questionId)` attempts.
5. **Fixture attempts mixed into authentic progress** — progress reports `nAuthenticQuizAttempts` / `nFixtureQuizAttempts` separately; meta authentic counts exclude fixtures.
6. **Sinhala domain chat** — explicit `unsupported_language` rather than silent EN corpus substitution.

## Verification

| Suite | Result | Log |
|-------|--------|-----|
| Canonical catalogue | 11/11 pass | `backend/api/tests/logs/canonical_catalogue_20261014_210534.log` |
| Integration | 13/13 pass | `backend/api/tests/logs/integration_20261014_210624.log` |
| Meeting contract | 4/4 pass | `backend/api/tests/logs/meeting_contract_20261014_210625.log` |
| Risk observation | 7 passed | `backend/api/tests/logs/risk_observation_20261014_210627.log` |

## Content status (`hist_sl_rajarata_politics`)

| | Count |
|--|------:|
| Authentic approved questions | 0 |
| Authentic approved resources | 0 |
| Fixture workflow | Tested (server policy required) |

## Providers

| | Status |
|--|--------|
| Generation | Adapter + offline tests; live not verified (`ARTS_AI_GENERATION_PROVIDER=none`) |
| Meeting | Webhook adapter; live not verified (`MEETING_INTEGRATION=unconfigured`) |

Not claimed: authentic Arts validation, teacher review, full syllabus coverage, live gen/meeting.
