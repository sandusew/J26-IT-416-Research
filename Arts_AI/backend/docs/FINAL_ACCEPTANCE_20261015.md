# Final acceptance — 2026-10-15 (deficit-fill closeout)

## Verdict

English practice-content backend implemented and verified on Atlas `arts_ai`; every working-scope topic has ≥12 distinct eligible published practice questions; human educational validation and external-provider verification remain pending where applicable.

## Before → after (practice bank)

| Metric | Before deficit-fill | After |
|--------|--------------------:|------:|
| Batch question rows | 531 | 540 |
| Unique `questionId::version` / published logical | 486 | **540** |
| Topics with ≥12 distinct published Q | 11 (logical) / claimed 36 (row-count) | **45/45** |
| Published resources | 45 | **45** |
| Authentic / teacher-reviewed | 0 | **0** |

### 531 vs 486 explained (evidence)

`backend/api/reports/practice_bank_reconciliation.json` (pre-fill):

- Combined batch listed **531** question objects but only **486** unique `questionId::version` keys (**45 duplicate keys**, mostly `q11`/`q12` repeated).
- Atlas published **486** distinct logical IDs — import/publish correctly collapsed duplicates.
- Quality report “topics ≥12 = 36” counted **rows per topic**, not distinct logical IDs; only **11** topics truly had ≥12 unique IDs.

Deficit-fill (`fill_practice_topic_deficits.py`) deduped, dropped boilerplate-grounded items where wiki text existed, authored **145** new source-grounded items, rebuilt the batch to **540** distinct IDs (**12×45**), then republished via `republish_repaired_practice.js` (scoped export first).

## Teaching content / index

- Serving index unchanged: `c4_index_20261014T173535_894e48ef` (295 chunks).
- Evidence: `backend/ml/reports/teaching_index_consistency.json` — all 45 `prac_pkg_*` packages present; token Jaccard ≥0.85 vs indexed chunks; **rebuild not required** (questions changed; teaching package bodies unchanged).

## Runtime verification

| Check | Result | Evidence |
|-------|--------|----------|
| API `/ready` Atlas `arts_ai` | pass | `/ready` |
| ML domain index | `c4_index_20261014T173535_894e48ef` | `/ready` |
| Published practice Q / R | **540 / 45** | `/catalogue/meta` |
| 12-Q assign all topics | **45/45** | `reports/topic_quiz_capacity.json` |
| `verify_populated_backend.js` | **20/20** | `reports/verify_populated_backend.json` |
| `demo_populated_e2e.js` | **26/26** | `reports/demo_populated_e2e.json` |

## Regression (isolated test DBs)

| Suite | Result | Log |
|-------|--------|-----|
| practice_publication | 5 pass | `tests/logs/practice_publication_20261015_deficit.log` |
| canonical_catalogue | 11 pass | `tests/logs/canonical_catalogue_20261015_deficit.log` |
| integration | 13 pass | `tests/logs/integration_20261015_deficit.log` |
| quiz_submission_recovery | 4 pass | `tests/logs/quiz_recovery_20261015_deficit.log` |
| fixture_derived_state | 1 pass | `tests/logs/fixture_derived_20261015_deficit.log` |
| meeting_provider_contract | 4 pass | `tests/logs/meeting_contract_20261015_deficit.log` |
| chat_fixture + risk_observation | 12 pass | `tests/logs/chat_risk_20261015_deficit.log` |

## Providers

- Generation: extractive domain chat usable; live LLM unconfigured ≠ pass.
- Meeting: booking with `meetingUrl=null`; live provider unconfigured ≠ pass.

## Start / demonstrate (Atlas; separate terminals)

```powershell
# Terminal A — backend\ml
.\.venv\Scripts\python.exe -m uvicorn arts_ai.inference.app:app --host 127.0.0.1 --port 8000

# Terminal B — backend\api  (uses .env; do not set conflicting shell MONGODB_URI)
node src\server.js

# Terminal C — backend\api
node scripts\verify_populated_backend.js
node scripts\verify_topic_quiz_capacity.js
node scripts\demo_populated_e2e.js
```

Normal startup does not reseed, republish, or retrain.

## Credentials

Atlas credentials preserved in local `backend/api/.env` (gitignored). Never printed or committed.
