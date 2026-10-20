# Continuation report — 2026-10-14 canonical catalogue workflow

Supersedes `CONTINUATION_REPORT_20261014_CURRICULUM_FIXES.md` for **remaining** handoff work. Historical NL / curriculum-fix evidence retained under prior reports.

## Verified ranker architecture

| Field | Value |
|-------|--------|
| Run | `c2_rank_rev_20261013T105157_40d91e8c` |
| Artifact | `backend/ml/artifacts/c2/…/ranker_pointwise.joblib` |
| SHA-256 | `3eed7793713963c641aa09e1216242a35f8b3e39a944ac696bd001fe082ce62d` |
| Pipeline | `StandardScaler` → `LogisticRegression` |
| Not | LightGBM (gap table corrected; do not retrain to match wrong docs) |

## Retrieval evaluation bound to current index

| Field | Value |
|-------|--------|
| Evaluation ID | `c4_retr_eval_20261014T005538_f17e0e8b` |
| Corpus / index | `c4_index_20261014T002208_333d545a` (16 docs / 77 chunks) |
| Index SHA-256 | `fc2a252be49ea9e1a927ff8ede78f840a349826a78f2c3b4232afa608dbc82c3` |
| Eval-set SHA-256 | `686d33ee6bd592b1a2b9aa5b06acccb302b63b019d740ee34fafe136a31dac65` |
| Config | BM25, top_k=5, subject + language filters |
| Hit@3 | **6/8** (0.75) |
| Recall@3 micro | **7/16** (0.4375) |
| Prior eval (archived) | `reports/historical/c4_domain_retrieval_eval__c4_index_20261014T002016_9178797b.json` |

## Canonical catalogue (implemented)

- `POST /catalogue/import` — dry-run or persist; staff/admin only; rejects `partial_match` as verified
- Review endpoints record actor + timestamp; fixtures labelled `isTestFixture`
- `POST /learning/quiz/:id/assign` — eligibility-based; frozen versions; 409 structured unavailable when bank empty
- Submit — ownership, answer-key server-side, no duplicate scores, essay auto-grade unavailable
- Recommendations `catalogueMode=canonical` + `trained_ranker` → documented incompatibility fallback

## Technical test slice (provisional)

`hist_sl_rajarata_politics` — selected for existing wiki extracts + clear NIE structure reference. **Not** final subject approval. Review package: `backend/ml/data/curriculum/review_packages/hist_sl_rajarata_politics_v0/`.

| Claim | Status |
|-------|--------|
| Workflow with labelled fixtures | Tested (`canonical_catalogue.test.js`) |
| Workflow with authentic approved content | **Not** exercised — bank empty |
| Authentic approved question count | **0** |

## Climate content

`wiki_en_climate_sri_lanka` acquired to `approved_pending` after bounded 429 retry. Still unreviewed; **not** promoted into serving index (outside hist slice; avoid count inflation).

## Tests (this phase)

| Suite | Command (cwd) | Result | Evidence |
|-------|---------------|--------|----------|
| Canonical catalogue | `node --test tests/canonical_catalogue.test.js` (`backend/api`) | 6/6 pass | `tests/logs/canonical_catalogue_*.log` |
| Integration | `node --test tests/integration.test.js` | 13/13 pass | `tests/logs/integration_20*.log` |
| Meeting contract | `node --test tests/meeting_provider_contract.test.js` | 4/4 pass | `tests/logs/meeting_contract_*.log` |
| Retrieval eval | `python scripts/eval_domain_retrieval.py` (`backend/ml`) | bound to 333d545a | `c4_domain_retrieval_eval.json` |

Not claimed from these suites: live generation, live meeting, teacher approval, full syllabus coverage.
