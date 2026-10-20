# Audit revision results

## Confirmed root causes

### C4 topic classifier (original acc≈0.042)
1. Sentence-split examples were **cross-topic generic templates** (diagnosis: 7 normalized templates covering 100% of test).
2. **v0/v1** were the same body with a prefix/suffix — not independent documents.
3. Shared `_TOPIC_FACTS[topic_idx]` stems caused **cross-subject confusions** once distinctive text was introduced.
4. Default `TfidfVectorizer` tokenisation **split hyphenated** `sub-*-primer` markers.

### C4 chat
`/v1/chat/ask` returns **`extractive_template`** by default (retrieved passages + preamble), **not** a generative LLM. Optional generation adapter exists (`ARTS_AI_GENERATION_PROVIDER`) but stays off without credentials / explicit local download permission. Twin + conversation history are used for retrieval boosts and answer preamble (`context_usage`).

### C2 Arts recommendations
1. Documented “baseline” **0.694 was label prevalence**, not a ranking baseline.
2. Primary metric was **pooled binary AP**, not per-request ranking on identical candidate sets.
3. Express `/learning/recommendations` serves **`prerequisite_aware`** with `trainedScorerUsed: false` — the learned ranker is offline/simulation evidence only.

### C3 OULAD observation window
Features use course-relative **days 0–13** (inclusive early window). This is **not** a “day-14 outcome” experiment; a separate day-14 horizon was intentionally not run.

### EdNet access
Official links (GitHub README → bit.ly + USTC mirror) are public CC BY-NC — not form-only. Legitimate download via `scripts/download_ednet.py`:
- **Contents:** acquired + extracted (`questions.csv` joined for correctness).
- **KT1:** full archive downloaded (1,218,656,153 bytes). Full extract of ~784k CSVs aborted as impractical on this laptop; **selective extract** of 2,500 CSVs → subset **200 students / 84,259 interactions** with `correct` derived from Contents. Train run `c2_ednet_20261013T120914_a0c32a13` (val selected majority baseline; LR ROC-AUC≈0.57 reported). No access-control bypass; no form submission on the user’s behalf.

---

## Before / after (protocols)

| Experiment | Before (preserved) | After (new run) | Protocol note |
|------------|--------------------|-----------------|---------------|
| C4 marker closed-set | acc 0.042 | acc **1.0** | **Sanity check only** — distinctive markers |
| C4 NL closed-set | — | test acc≈**0.722**; maj≈0.056; lex≈0.633 | No topic/template/filename shortcuts in model input |
| C4 unseen-topic | N/A | marker F1≈0.57; NL F1≈0.53 | Separate task |
| C2 ranking | pooled AP≈prevalence | NDCG@10 learned≈0.20 > random≈0.14; bootstrap by student | Simulation only; query stats recorded |
| C3 UCI revised | Math-only 0.879 | no-G1/G2 ≈0.39; key-split ≈0.74 | Different protocols |

### New run paths (selected)
- C4 NL: `artifacts/c4/c4_topic_nl_20261013T105116_04964504/` ; `reports/c4_topic_nl_metrics.json`
- C4 chat scope: `c4_chat_eval_20261013T105940_d7a33620` ; `reports/c4_chat_scope_eval.json`
- C2 rank: `artifacts/c2/c2_rank_rev_20261013T105157_40d91e8c/` ; `reports/c2_ranking_REVISED.json`
- Marker sanity (preserved): `c4_topic_rev_20261013T100629_127fbaec`
- Original backups: `reports/audit/*_ORIGINAL.json`

---

## API / integration evidence

Write flows implemented: twin update, diagnostic assign/complete, quiz submit+progress, peer join-request/approve/capacity, consultations, notifications from events.

**Integration tests executed (not merely authored):**
- Command: `node --test tests/integration.test.js` (cwd `backend/api`)
- Result: **8 passed, 0 failed, 0 skipped**, exit code **0**
- Logs: `backend/api/tests/last_run.log`, `backend/api/tests/logs/integration_pass_8of8.log`, `backend/api/tests/logs/integration_rerun.log`
- Mongo: `mongodb-memory-server` (binary already cached; 120s startup bound). `TEST_MONGODB_URI` supported for local Mongo with unique `arts_ai_test_*` DB cleanup.

Meeting provider remains **unconfigured / untested** (no fabricated URLs).

---

## Remaining blockers
1. Generative chat requires user-supplied API key (`ARTS_AI_LLM_API_KEY` + provider env) or explicit local model download permission (`ARTS_AI_ALLOW_MODEL_DOWNLOAD=true`).
2. Wire trained C2 Arts ranker into HTTP only if product decision requires it (currently prerequisite policy by design).
3. OULAD→Arts transfer unevaluated; separate day-14 risk experiment not run.
4. Meeting provider smoke test (user action) before claiming ready.
5. Optional: larger EdNet student pool than 200 if hardware/disk allow (archive already local).
