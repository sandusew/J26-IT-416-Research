# Arts AI — Model Status (evidence-based)

Regenerate freeze: `backend/ml/scripts/generate_current_state_manifest.py` → `CURRENT_STATE_MANIFEST.json`.  
Verified identities: `MODEL_IDENTITIES.md` / `reports/model_identities_verified.json` (from `joblib.load`, not filenames).

| Component | Status | Data category | Key results | Paths |
|-----------|--------|---------------|-------------|-------|
| C1 K-Means | Trained / serving | authentic_public | sil_test≈0.223 | `c1_20261013T030329_134eeb26` |
| C2 EdNet **v1** | Preserved | authentic_public | Majority on +F1 | `c2_ednet_20261013T121127_34960c38` |
| C2 EdNet **v2 (serving)** | Trained / serving | authentic_public | test ROC-AUC≈0.698 | `c2_ednet_v2_20261013T153128_f83023f6` |
| C2 Arts pooled AP | Preserved | synthetic_learner | AP≈0.672, n=1578 | **`c2_arts_20261013T025936_8b27814f`** (not `030235`) |
| C2 Arts `030235` | Separate tiny run | synthetic_learner | n=20; do not cross-assign AP | `c2_arts_20261013T030235_5a8b703d` |
| C2 ranking | Opt-in; synthetic vocab only | synthetic_learner | **StandardScaler→LogisticRegression**; default HTTP = prerequisite_aware; canonical → fallback | `c2_rank_rev_20261013T105157_40d91e8c` |
| C3 OULAD risk | Trained / serving | authentic_public | days **0–13**; zero-activity eligible with complete observation | `c3_oulad_20261013T030421_2f6e0ea2` |
| C4 topic NL | Serving | generated_content — closed-set | **TfidfVectorizer → LogisticRegression** (35 classes); acc≈0.722; **≠ chatbot accuracy**; **≠ DistilBERT** | `c4_topic_nl_20261013T105116_04964504` via `LATEST_TOPIC_SERVING` |
| C4 marker topic | Historical only | generated_content | acc=1.0 sanity | `c4_topic_rev_20261013T100629_127fbaec` |
| C4 fixture index | Indexed (not training) | generated_content | Default chat corpus | `artifacts/c4/knowledge_index.joblib` |
| C4 domain index | Indexed (not training) | CC BY-SA supplemental; **unreviewed** | See `LATEST_DOMAIN_INDEX` (current handoff: 16 docs / 77 chunks) | `data/arts_content/indexes/c4_index_*` |
| Curriculum registry | Provisional structure | NIE titles (not teaching license) | 45 in-scope topics; official LO 0/45; teacher review 0/45 | `nie_al_arts_provisional_v0.1` |

### Endpoint → artifact

| Endpoint | Loads |
|----------|-------|
| `POST /v1/behaviour/cluster` | C1 `kmeans_pipeline.joblib` |
| `POST /v1/risk/predict` | C3 OULAD risk (observation metadata contract) |
| `POST /v1/correctness/predict` | EdNet v2 |
| `POST /v1/recommendations/score` | Ranker (opt-in; historical synthetic only) |
| `GET /learning/recommendations` | Default `prerequisite_aware`; `trained_ranker` + `catalogueMode=canonical` → fallback |
| `POST /v1/topic/classify` | NL TF-IDF+LR (`LATEST_TOPIC_SERVING`) — C4 component, shared as topic hint |
| `POST /v1/chat/ask` | Default `corpus_mode=domain`; `fixture` only with server flags (API+ML); optional `subject_id`/`language` |

Meeting: adapter implemented; **live not verified**. Generation: adapter implemented; **live not verified**.

Canonical catalogue / quiz: server-side fixture isolation; durable submission recovery. Chat default **domain**. Authentic approved question/resource counts remain **0**. Live gen/meeting smoke scripts present; live verification pending credentials.

**Practice population (2026-10-14):** 45/45 EN topic packages; 540 published AI-authored practice questions; domain index c4_index_20261014T173535_894e48ef; authentic/teacher-reviewed still 0; Sinhala Literature deferred. See CONTENT_POLICY.md and CONTINUATION_REPORT_20261014_PRACTICE_CONTENT.md.

**Handoff 2026-10-15:** Atlas DB arts_ai via `.env`; verify with `node scripts/verify_populated_backend.js`. Published practice after quality repair is tracked in `/catalogue/meta` coverage (not forced to 540). Live gen/meeting still blocked≠pass.

**Deficit-fill 2026-10-15:** Published practice bank is **540** distinct questions (45 topics × 12). Verify with 
ode scripts/verify_populated_backend.js and 
ode scripts/verify_topic_quiz_capacity.js. Index c4_index_20261014T173535_894e48ef unchanged. Live gen/meeting still blocked≠pass.
