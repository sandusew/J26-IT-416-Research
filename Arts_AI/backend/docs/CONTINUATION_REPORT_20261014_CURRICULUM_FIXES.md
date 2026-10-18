# Continuation report — 2026-10-14 curriculum fixes

**Status:** current handoff (supersedes older narrative counts for domain corpus size).

## Historical note (do not overwrite)

`CONTINUATION_REPORT_20261013_NL_SERVING.md` remains historical evidence (earlier NL serving / smaller domain index, e.g. 4 docs / 23 chunks). This file is the **current** continuation after curriculum-accounting, risk, and ranker compatibility fixes.

## Current serving pointers (verified)

| Pointer | Value |
|---------|--------|
| Domain index | `LATEST_DOMAIN_INDEX` → see `c4_knowledge_ingest_status.json` (**16 documents / 77 chunks** at time of this report) |
| Topic NL | `c4_topic_nl_20261013T105116_04964504` — **sklearn TfidfVectorizer → LogisticRegression**, not DistilBERT |
| EdNet | `c2_ednet_v2_20261013T153128_f83023f6` |
| Ranker | `c2_rank_rev_20261013T105157_40d91e8c` (historical synthetic vocab only) |
| C3 risk | `c3_oulad_20261013T030421_2f6e0ea2` |
| Curriculum | `nie_al_arts_provisional_v0.1` (provisional; approved proposal still missing) |

## Retrieval evaluation (single corpus + eval set)

- **Corpus/index:** value in `c4_domain_retrieval_eval.json` → `corpus_version`
- **Eval set:** `backend/ml/data/arts_content/eval/domain_retrieval_eval_cases.json` (11 cases; machine-authored)
- **Eligible Hit@3 denominator:** 8 (excludes Sinhala + wrong-subject probe)
- **Hit@3:** 6/8 = 0.75 (core-only 4/5 = 0.8)
- **Multi-gold Recall@3 micro:** see `c4_retrieval_eval_audit.json` (do not conflate with Hit@3)
- Do not mix metrics from the older 4-doc index with this set

## Coverage (provisional denominator = 45 topics)

See `CURRICULUM_COVERAGE_SUMMARY.md`. Official LO text 0/45; supplemental content mapped; verified questions 0/45; teacher review 0/45. Synthetic partial_match ≠ verified.

## Risk contract

`/v1/risk/predict` distinguishes no observation, incomplete window, complete zero-activity (`ok_zero_activity`), complete with activity, unsupported application domain. `experimental_domain_transfer` does not bypass missing features. Tests: `backend/ml/tests/test_risk_observation_cases.py`.

## Ranker

`trainedScorerUsed=true` only for historical synthetic catalogue. `catalogueMode=canonical` → prerequisite fallback with `topic_vocabulary_incompatible_*`.

## Remaining blockers

Approved proposal; scope confirmation; teacher review; verified question bank; generation/meeting credentials; climate wiki acquire blocked by HTTP 429 once.
