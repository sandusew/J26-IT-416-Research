# Continuation report — domain content, retrieval, adapters

Supersedes prior NL-serving handoff notes for **remaining** backend work. Historical NL/ranker evidence retained under `backend/ml/reports/` and `backend/api/reports/`.

## Implemented changes and purpose

1. **Domain corpus workflow** — acquire CC BY-SA Wikipedia extracts aligned to existing subject IDs; record NIE PDFs as **candidates** (reuse unclear); promote only when usage permitted + extraction OK + curriculum relevance checked; never auto teacher-review.
2. **Domain retrieval index** — versioned BM25 index separate from fixtures; chat `corpus_mode=domain|fixture`; domain miss → honest insufficient evidence (no fixture substitution).
3. **Retrieval evaluation** — 7 machine-authored questions (held out of the index); Recall@3 reported honestly; Sinhala support not claimed.
4. **Generation adapter** — prompt hardened against passage instruction injection; timeouts; `.env.example` placeholders; offline tests; live **awaiting credentials**.
5. **Meeting** — webhook contract documented; idempotent approve; offline contract tests; live **awaiting provider/credentials**.
6. **Docs/manifest** — project-relative paths; C2 AP run `025936` vs tiny `030235`; indexing ≠ training; integration ≠ educational effectiveness.

## Files changed (this phase)

- `backend/ml/scripts/acquire_domain_candidates.py`
- `backend/ml/scripts/eval_domain_retrieval.py`
- `backend/ml/scripts/generate_current_state_manifest.py`
- `backend/ml/src/arts_ai/c4_chatbot/knowledge_ingest.py`, `rag.py`, `generation.py`
- `backend/ml/src/arts_ai/inference/app.py`
- `backend/api/src/routes/ml.js`, `consultations.js`
- `backend/api/tests/meeting_provider_contract.test.js`
- `backend/api/.env.example`, `backend/ml/.env.example`
- Docs under `backend/docs/*`; content under `backend/ml/data/arts_content/*`

## Serving map (actual)

| Endpoint | Artifact |
|----------|----------|
| Topic classify | `c4_topic_nl_20261013T105116_04964504` |
| Ranker (opt-in) | `c2_rank_rev_20261013T105157_40d91e8c` |
| EdNet | `c2_ednet_v2_20261013T153128_f83023f6` |
| Chat fixture | `artifacts/c4/knowledge_index.joblib` |
| Chat domain | `c4_index_20261013T175801_794360d9` (4 docs / 23 chunks) |

## Tests / evidence

| Check | Result | Path |
|-------|--------|------|
| Integration + meeting contract | **15 pass / 0 fail** | `backend/api/tests/logs/integration_post_domain_content.log` |
| Trained ranker Express→ML | pass | `backend/api/reports/trained_ranker_express_smoke.json` |
| Domain acquisition | 4 wiki + 2 NIE candidates | `backend/ml/reports/c4_domain_acquisition.json` |
| Domain ingest | ready | `backend/ml/reports/c4_knowledge_ingest_status.json` |
| Domain retrieval eval | Recall@3≈0.833; 7 Qs | `backend/ml/reports/c4_domain_retrieval_eval.json` |
| Generation offline | 2/2 | `backend/ml/reports/c4_generation_adapter_offline.json` |
| Meeting smoke | **not written** | awaiting credentials |
| Final manifest | UTC stamp | `backend/docs/CURRENT_STATE_MANIFEST.json` |

## Corpus / generation / meeting status

- **Corpus:** Acquired + usage-permitted (CC BY-SA) + extraction checked + curriculum-relevance checked; **awaiting teacher review**. NIE: acquired candidate, **awaiting permission**.
- **Generation:** Implemented; offline verified locally; **awaiting credentials** for live.
- **Meeting:** Implemented (http_webhook contract); offline verified; **awaiting provider choice/credentials** for live.

## Startup / demo (repo root)

```powershell
# Terminal A
cd backend\ml
.\.venv\Scripts\python.exe -m uvicorn arts_ai.inference.app:app --host 127.0.0.1 --port 8000

# Terminal B
cd backend\api
$env:ML_INFERENCE_URL='http://127.0.0.1:8000'
npm start
```

## Remaining user actions

1. Teacher-review domain extracts (`TEACHER_REVIEW_TEMPLATE.md`).
2. Clarify NIE reuse or leave candidates unindexed.
3. Optional: set generation API key for live gen smoke.
4. Optional: choose meeting provider + credentials + run real smoke → `meeting_smoke_test.json`.
5. Real A/L student validation before effectiveness claims.
