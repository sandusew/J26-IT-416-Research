# Arts AI — Viva Demonstration Guide

## What to show (current)

1. **Requirements honesty:** Approved proposal still **MISSING** — provisional NIE-referenced scope only (`SCOPE_DECISIONS.md`).
2. **Model identity:** NL topic classifier is **TF-IDF + LogisticRegression** (`MODEL_IDENTITIES.md`) — not DistilBERT. Serving run `c4_topic_nl_20261013T105116_04964504`.
3. **Serving ranker:** **StandardScaler → LogisticRegression** (`c2_rank_rev_20261013T105157_40d91e8c`, sha `3eed7793…ce62d`) — not LightGBM.
4. **Coverage:** `CURRICULUM_COVERAGE_SUMMARY.md` — structure ≠ official LO ≠ supplemental content ≠ verified questions ≠ teacher review. Authentic approved questions: **0**.
5. **Risk:** complete zero-activity → `ok_zero_activity`; missing observation → not inferred from zeros alone.
6. **Ranker policy:** historical synthetic `trained_ranker` can score; `catalogueMode=canonical` falls back with incompatible topic vocabulary reason.
7. **Domain RAG:** `LATEST_DOMAIN_INDEX` = `c4_index_20261014T002208_333d545a` (16 docs / 77 chunks).
8. **Retrieval metrics (bound to that index):** evaluation `c4_retr_eval_20261014T005538_f17e0e8b` — Hit@3 **6/8**; multi-gold Recall@3 **7/16**. Prior eval on `9178797b` archived under `reports/historical/`.
9. **Chat default:** `corpus_mode=domain`; fixture chat needs server flags on **API and ML**; production rejects.
10. **Canonical workflow:** fixture-tested under `ARTS_AI_ALLOW_TEST_FIXTURES`; empty authentic bank still **409**.
11. **Submission recovery:** lease + pending fingerprint; `recover_stuck_submissions` — not a blind reset.
12. **Twin:** authentic aggregates from `isTestFixture=false` attempts only; client performance cannot override.
13. **Suites:** integration 13, canonical 11, recovery 4, chat policy 5, derived-state 1, meeting 4, risk 7.
14. **Live smoke scripts:** `smoke_generation_live.py --live`, `smoke_meeting_live.js --live` — blocked≠pass without credentials.

## Honest non-claims

Full research complete, 100% syllabus coverage, authentic teacher-reviewed bank, institutional validation, Sinhala QA, live meeting/gen, DistilBERT topic model, LightGBM serving ranker, fixture approvals as real review.

**Practice population (2026-10-14):** 45/45 EN topic packages; 540 published AI-authored practice questions; domain index c4_index_20261014T173535_894e48ef; authentic/teacher-reviewed still 0; Sinhala Literature deferred. See CONTENT_POLICY.md and CONTINUATION_REPORT_20261014_PRACTICE_CONTENT.md.

**Handoff 2026-10-15:** Atlas DB arts_ai via `.env`; verify with `node scripts/verify_populated_backend.js`. Published practice after quality repair is tracked in `/catalogue/meta` coverage (not forced to 540). Live gen/meeting still blocked≠pass.

**Deficit-fill 2026-10-15:** Published practice bank is **540** distinct questions (45 topics × 12). Verify with 
ode scripts/verify_populated_backend.js and 
ode scripts/verify_topic_quiz_capacity.js. Index c4_index_20261014T173535_894e48ef unchanged. Live gen/meeting still blocked≠pass.
