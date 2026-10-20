# Arts AI — Local Setup

## Hardware profile (bootstrap machine)

| Item | Value |
|------|--------|
| OS | Windows 10+ |
| RAM | ~16 GB class laptop tested |
| Python | 3.11+ (3.13 tested in `.venv`) |
| Node | 18+ |

Training uses bounded `n_jobs` and CPU by default.

## Prerequisites

- Python 3.11+
- Node.js 18+
- Optional local MongoDB; integration tests can use `mongodb-memory-server` or `TEST_MONGODB_URI`

All commands below assume the **repository root** unless a `cd` is shown. Use **separate terminals** for ML and API.



## Atlas-backed startup (current default)

Docker MongoDB is **optional**. Normal startup uses `backend/api/.env` (gitignored).

```powershell
# Terminal A — ML (repo\backend\ml)
.\.venv\Scripts\python.exe -m uvicorn arts_ai.inference.app:app --host 127.0.0.1 --port 8000

# Terminal B — API (repo\backend\api)
# Ensure backend\api\.env has MONGODB_URI pointing at Atlas DB arts_ai
# Do not set a conflicting shell MONGODB_URI (stale local overrides are ignored unless ARTS_AI_MONGO_URI_SOURCE=shell)
node src\server.js
```

Safe readiness check (no secrets printed):

```powershell
cd backend\api
node scripts\verify_populated_backend.js
```

Optional local Mongo remains only for offline experimentation; it is not required when Atlas is configured.

## 1. Python ML environment

```powershell
cd backend\ml
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -e .
```

Resolved versions: `backend/ml/environment/resolved_versions.txt`.

## 2. Data / training (do not re-run unless needed)

Existing artifacts under `backend/ml/artifacts/` should be reused. Pipeline:

```powershell
cd backend\ml
.\.venv\Scripts\python.exe scripts\run_pipeline.py
```

## 3. Curriculum registry + domain knowledge (indexing ≠ training)

```powershell
cd backend\ml
.\.venv\Scripts\python.exe -m arts_ai.curriculum.registry
.\.venv\Scripts\python.exe scripts\acquire_curriculum_aligned_corpus.py
.\.venv\Scripts\python.exe -m arts_ai.c4_chatbot.knowledge_ingest
.\.venv\Scripts\python.exe -m arts_ai.curriculum.coverage
.\.venv\Scripts\python.exe -m arts_ai.curriculum.catalogue
.\.venv\Scripts\python.exe scripts\audit_retrieval_eval.py
.\.venv\Scripts\python.exe scripts\eval_domain_retrieval.py
```

- Provisional curriculum: `data/curriculum/nie_al_arts_provisional_v0.1_registry.json`
- Wikipedia CC BY-SA extracts → supplemental domain index (unreviewed; not full syllabus)
- NIE PDFs → `data/arts_content/candidates/` only (permission unclear)

## 4. FastAPI ML inference (terminal A)

```powershell
cd backend\ml
.\.venv\Scripts\python.exe -m uvicorn arts_ai.inference.app:app --host 127.0.0.1 --port 8000
```

Check: `Invoke-RestMethod http://127.0.0.1:8000/ready`

## 5. Express gateway (terminal B)

```powershell
cd backend\api
# Create .env only if missing — never overwrite existing Atlas secrets
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm install
# Normal startup: do NOT reseed or republish. Atlas is already configured in .env.
node src\server.js
```

Idempotent demo-user ensure (optional; does not reset passwords):

```powershell
cd backend\api
node scripts\seed_demo_users.js
```

Demo accounts are **synthetic fixtures** (see seed script).

## 6. Generative chat (optional) — dual process env

Express (`backend/api`) and FastAPI (`backend/ml` uvicorn) are **separate processes**. Putting a key only in `backend/api/.env` does **not** configure generation inside Python unless FastAPI also loads it.

Verified load order in `arts_ai.inference.app` (startup):

1. `backend/ml/.env` (preferred for ML secrets)
2. `backend/api/.env` (fallback; does not override vars already set)

Example (do not commit secrets):

```powershell
# Prefer ML-local env for generation — create only if missing
cd backend\ml
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Edit backend/ml/.env (do not print secrets):
# ARTS_AI_GENERATION_PROVIDER=openai_compatible
# ARTS_AI_GENERATION_MODEL=gpt-4o-mini
# ARTS_AI_GENERATION_API_BASE=https://api.openai.com/v1
# ARTS_AI_LLM_API_KEY=...
```

**Env precedence (verified in `arts_ai.inference.app`):**

1. Process environment variables already set  
2. `backend/ml/.env` (`override=False`)  
3. `backend/api/.env` as fallback (`override=False`)

Express reads only `backend/api/.env` (and process env). Putting a key solely in `api/.env` reaches FastAPI only via the fallback load after uvicorn restart. Default without credentials remains `extractive_template`.

Safe examples (no secrets): `backend/api/.env.example`, `backend/ml/.env.example`.

Offline adapter check:

```powershell
cd backend\ml
.\.venv\Scripts\python.exe scripts\test_generation_adapter_offline.py
```

## 7. Meeting provider (optional)

See `MEETING_INTEGRATION.md`. Without credentials, URLs stay `null`.

```powershell
cd backend\api
node --test tests\meeting_provider_contract.test.js
```

## 8. Tests

```powershell
cd backend\api
$env:ML_INFERENCE_URL='http://127.0.0.1:8000'
node --test tests\integration.test.js
node --test tests\canonical_catalogue.test.js
node --test tests\meeting_provider_contract.test.js
node tests\trained_ranker_live_smoke.js

cd ..\ml
.\.venv\Scripts\python.exe scripts\verify_topic_nl_parity.py
.\.venv\Scripts\python.exe scripts\verify_trained_ranker_http.py
.\.venv\Scripts\python.exe scripts\eval_domain_retrieval.py
.\.venv\Scripts\python.exe scripts\audit_retrieval_eval.py
pytest tests\test_risk_observation_cases.py -q
```

Optional: `TEST_MONGODB_URI=mongodb://127.0.0.1:27017` (unique `arts_ai_test_*` DB only).

## 8b. Canonical fixture import demo (isolated; not authentic review)

Requires non-production + server flag (client flag alone is rejected):

```powershell
# backend\api\.env
# ARTS_AI_ALLOW_TEST_FIXTURES=true
# NODE_ENV=development
```

With API + Mongo running:

```powershell
cd backend\api
$tea = Invoke-RestMethod -Method POST http://127.0.0.1:4000/auth/login -ContentType 'application/json' -Body '{"username":"tea","password":"pw"}'
$hdr = @{ Authorization = "Bearer $($tea.token)" }
$batch = Get-Content ..\ml\data\curriculum\review_packages\hist_sl_rajarata_politics_v0\fixture_import_batch.json -Raw | ConvertFrom-Json
Invoke-RestMethod -Method POST http://127.0.0.1:4000/catalogue/import -Headers $hdr -ContentType 'application/json' -Body ($batch | ConvertTo-Json -Depth 8)
$batch.dryRun = $false
$batch.questions = @($batch.questions | Where-Object { $_.mappingStatus -ne 'partial_match' })
Invoke-RestMethod -Method POST 'http://127.0.0.1:4000/catalogue/import?dryRun=false' -Headers $hdr -ContentType 'application/json' -Body ($batch | ConvertTo-Json -Depth 8)
# Review with reviewEvidence labelled TEST_FIXTURE…; assign with allowTestFixtures=true
# See review package README
```

### Generation live smoke

```powershell
cd backend\ml
# Configure provider on the ML process (.env), then:
.\.venv\Scripts\python.exe scripts\smoke_generation_live.py
# Live (exit 0 only after real generative response):
.\.venv\Scripts\python.exe scripts\smoke_generation_live.py --live
```

Without credentials the script exits **2** (`blocked_missing_configuration`) — not a pass.

### Meeting live smoke

```powershell
cd backend\api
node scripts\smoke_meeting_live.js
# Live (requires MEETING_INTEGRATION=configured + PROVIDER + API_BASE + API_KEY):
node scripts\smoke_meeting_live.js --live
```

Uses `MEETING_SMOKE_RUN=1` only inside the script to break the readiness↔smoke circular dependency without weakening normal readiness.

### Stuck submission recovery

```powershell
cd backend\api
node src\scripts\recover_stuck_submissions.js --dry-run
node src\scripts\recover_stuck_submissions.js
# Or authenticated: POST /learning/quiz/recover-stuck-submissions
```

## 8c. Populate AI-authored practice content (not teacher approval)

Atlas `arts_ai` is already populated for normal demos. Re-author/import only when content changes. Docker Mongo is optional and not required when Atlas `.env` is set.

```powershell
# Author / resume packages (cwd backend\ml)
.\.venv\Scripts\python.exe scripts\build_topic_source_map.py
.\.venv\Scripts\python.exe scripts\author_practice_content.py
.\.venv\Scripts\python.exe scripts\audit_and_repair_practice_content.py

# Rebuild domain index only if teaching corpus text changed
.\.venv\Scripts\python.exe -m arts_ai.c4_chatbot.knowledge_ingest
.\.venv\Scripts\python.exe scripts\report_practice_coverage.py

# Import + publish-practice (cwd backend\api) — does NOT forge teacher review
node scripts\import_and_publish_practice.js --dry-run
node scripts\republish_repaired_practice.js
node scripts\seed_demo_users.js
node scripts\verify_populated_backend.js
node scripts\demo_populated_e2e.js
```

Set `ARTS_AI_CONTENT_POLICY=published_practice` (default) on the API. Use `teacher_reviewed_only` to exclude unreviewed practice. See `CONTENT_POLICY.md`.

## 9. Manifest

Generate **last** after tests:

```powershell
cd backend\ml
.\.venv\Scripts\python.exe scripts\generate_current_state_manifest.py
```

**Deficit-fill 2026-10-15:** Published practice bank is **540** distinct questions (45 topics × 12). Verify with 
ode scripts/verify_populated_backend.js and 
ode scripts/verify_topic_quiz_capacity.js. Index c4_index_20261014T173535_894e48ef unchanged. Live gen/meeting still blocked≠pass.
