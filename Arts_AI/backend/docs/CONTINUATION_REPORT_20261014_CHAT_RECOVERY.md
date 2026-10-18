# Continuation report — 2026-10-14 chat isolation & submission recovery

Supersedes `CONTINUATION_REPORT_20261014_FIXTURE_ISOLATION.md` for this phase.

## Defects fixed (paths)

| Defect | Fix |
|--------|-----|
| Chat defaulted to `corpus_mode=fixture` | Default **domain** in Express (`routes/ml.js`) and FastAPI (`inference/app.py`) |
| Client body alone enabled fixture chat | FastAPI `arts_ai/common/fixture_policy.py` + Express `fixturePolicy.js`; production rejects |
| Node fixture env did not reach Python | Documented separate ML `.env`; FastAPI enforces its own env |
| `submitting` could strand after crash | Durable `pendingResponses`/`pendingFingerprint`/lease in `services/quizSubmission.js` |
| Concurrent double notifications | Deterministic `notificationId = ntf_cq_<assignmentId>` |
| Client Twin topic_performance overrode authentic | Twin derives authentic aggregates from `QuizAttempt` (`isTestFixture=false` only) |

## Verification highlights

- Chat fixture policy: 5/5 `tests/test_chat_fixture_policy.py`
- Submission recovery: 4/4 `tests/quiz_submission_recovery.test.js`
- Fixture derived state: 1/1 `tests/fixture_derived_state.test.js`
- Canonical 11, integration 13, meeting 4, risk 7 — all pass
- Live generation/meeting smoke scripts executable; both **blocked_missing_configuration** without credentials (exit 2 ≠ pass)

## Authentic content

Authentic approved questions/resources: **0**. E2E learning checks used labelled fixtures under server policy.
