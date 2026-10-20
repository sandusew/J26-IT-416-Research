# Component model-gap table

Architectures below match verified local artifacts (`backend/ml/reports/model_identities_verified.json`). Do not infer from filenames.

| Capability (guideline / PROV) | Current model/method | Training data / domain | Supported labels/features | Intended application inputs | Compatibility gaps | Action |
|-------------------------------|----------------------|------------------------|---------------------------|-----------------------------|--------------------|--------|
| C1 behaviour clusters | OULAD K-Means pipeline | OULAD public VLE | Cluster IDs; day-window features | Twin behaviour fields | Feature meanings ≠ A/L click logs | **reuse** experiment; do not reinterpret as style/mastery |
| C1 mastery estimation | None trained | — | — | Quiz/diagnostic topic evidence | No labelled mastery targets | **rule-based baseline** (observed performance only); **awaiting data** |
| C2 item correctness | EdNet v2 logistic (serving) | EdNet KT1 subset | EdNet item IDs / history features | Historical EdNet-style features | Item IDs ≠ Arts question_ids | **reuse** as public-domain experiment only |
| C2 resource ranking | **Serving:** `StandardScaler` → `LogisticRegression` pointwise (`c2_rank_rev_20261013T105157_40d91e8c`, sha `3eed7793…ce62d`). Historical ranking experiments may mention other learners under their own run IDs — do not conflate. | Synthetic catalogue | Synthetic `sub_*_tNN`; features `difficulty`, `stu_open_rate` | Historical synthetic recommendations | Canonical curriculum topic IDs incompatible | **reuse** serving LR pipeline; fallback when `catalogueMode=canonical`; default remains prerequisite_aware |
| C4 NL topic labels (shared hint; **not C2**) | **sklearn `TfidfVectorizer` → `LogisticRegression`** (NOT DistilBERT) | Generated closed-set docs | 35 synthetic topic IDs | `POST /v1/topic/classify` | New curriculum topics unrecognized | **reuse**; do **not** hard-gate domain chat |
| C4 marker topics | Marker Logistic/TF-IDF (historical) | Same era | Marker labels | Historical pointer only | Superseded for serving by NL run | **reuse** historical evidence only |
| C3 academic risk | OULAD LightGBM (selected) + LR/dummy | OULAD | VLE features; cutoff days 0–13; zero-activity kept with recency=cutoff+1 | Explicit observation metadata required | App events ≠ OULAD unless contract met | **reuse**; distinguish no/incomplete/zero/complete/unsupported |
| C3 progress | Rule summaries | App quiz events | Topic performance | Twin/progress APIs | Not grade prediction | **reuse** |
| C4 retrieval | BM25 domain index | Supplemental CC BY-SA wiki | Doc/chunk + subject/language filters | Domain chat | Coverage ≠ full syllabus | **reuse**; expand corpus; evaluate vs BM25 before new embeddings |
| C4 generation | Optional LLM adapter | External API | — | Chat answers | Key in FastAPI process (`ml/.env` then `api/.env`) | **integrate** when configured |
| C4 consultation match | Rule (subject + availability) | Synthetic teachers | Subject expertise | Booking | — | **reuse** |

## Training decisions

- **No automatic mass retrain** to match a wrong document claim.
- DistilBERT was an inaccurate documentation claim; the serving NL artifact remains TF-IDF + LogisticRegression.
- Synthetic ranker / EdNet / OULAD remain public or synthetic — not local institutional validation.
