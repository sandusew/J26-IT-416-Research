# Continuation report — 2026-10-15 Atlas handoff

## Issues found and fixed

| Issue | Fix |
|-------|-----|
| Stale shell `MONGODB_URI` could override Atlas `.env` | `config/index.js` prefers `backend/api/.env`; warn + ignore shell unless `ARTS_AI_MONGO_URI_SOURCE=shell` |
| API started with persistence disabled on Mongo failure | `server.js` exits non-zero; no silent degraded start |
| Import script fell back to memory Mongo | Removed; fail clearly |
| Seed wiped demo users / reset passwords | Idempotent ensure-only seed |
| Credential leakage in logs | Safe mongo identity on `/ready` + redacted connect logs |
| Practice bank quality defects (fillers, answer leaks, weak grounding) | `audit_and_repair_practice_content.py`; withdraw + batch-only republish |
| Over-publish of superseded drafts | `republish_repaired_practice.js` publishes only repaired batch keys |
| Retrieval “improvement” claim across different gold sets | Documented non-comparability (`retrieval_eval_comparability.md`) |

## Content quality (honest)

- Review kinds: structural, near-duplicate, template repetition, lexical source-support heuristic, package substance.
- **Not** teacher factual validation.
- Eligible published practice questions after repair: **486** (not forced to 540).
- Published resources: **45**.
- Topics with ≥1 assignable question: **45/45**.
- Topics with ≥12 questions: **36/45** (see quality report).
- Authentic approved / teacher-reviewed: **0**.

## Verification

- `verify_populated_backend.js`: 20/20 (Atlas identity `arts_ai`)
- Topic eligibility sweep: 45/45 assignable
- Demo E2E: 26/26
- Suites: practice 5, canonical 11, integration 13, recovery 4, fixture-derived 1, meeting 4, chat+risk 12
- Domain index unchanged: `c4_index_20261014T173535_894e48ef` (no retrain; index not rebuilt this phase)
- Live gen/meeting: still blocked ≠ pass

## Atlas

Credentials preserved as configured in local `.env` (not committed). Diagnostics never print passwords.
