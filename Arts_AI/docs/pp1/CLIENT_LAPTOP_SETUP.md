# Client laptop setup (instructions prepared)

**Status:** Instructions prepared on the development machine. Cross-machine verification on the client laptop is **not claimed** until these steps are actually run there.

## Required software (tested here)

| Tool | Tested version |
|------|----------------|
| Node.js | v24.10.0 |
| npm | 11.6.1 |
| Python | 3.13.9 |

## Working directories

Repo root: `Arts_AI`

| Service | Directory |
|---------|-----------|
| FastAPI ML | `backend/ml` |
| Express API | `backend/api` |
| React UI | `frontend` |

## Ports (do not kill unrelated processes)

| Port | Service |
|------|---------|
| 8000 | FastAPI ML |
| 4000 | Express API |
| 5173 | Vite frontend |

If a port is busy: identify the owning process, confirm it is an Arts AI service, then stop **only that** process. Do not terminate unknown listeners.

## Environment variable names (no values)

API (`backend/api/.env`):

- `MONGODB_URI` (Atlas `arts_ai`)
- `JWT_SECRET`
- `ML_INFERENCE_URL` (alias `ML_BASE_URL` if the first is unset; typically `http://127.0.0.1:8000`)
- `ARTS_AI_CONTENT_POLICY` (default `published_practice`)
- `RECOMMENDATION_POLICY` (default `prerequisite_aware`)
- Optional meeting / generation provider keys — leave unset for extractive chat + `meetingUrl=null`

ML (`backend/ml/.env` if used):

- Serving pointers under `artifacts/` (do not retrain for PP1)
- `ARTS_AI_ALLOW_TEST_FIXTURES` only for isolated tests

Frontend: optional `VITE_API_BASE_URL`; default Vite proxy `/api` → `:4000`.

## Dependency install

```powershell
cd backend\api
npm install

cd ..\ml
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt

cd ..\..\frontend
npm install
```

## Model / index files required (no retrain)

Confirm ML `/ready` reports loaded:

- C1 / C3 OULAD pipelines (serving runs in `/ml/ready` response)
- C2 EdNet v2 correctness pipeline
- C2 ranker `c2_rank_rev_*`
- C4 topic NL classifier via `LATEST_TOPIC_SERVING`
- Domain knowledge index (handoff: `c4_index_20261014T173535_894e48ef`)

## Atlas

- Database name: `arts_ai`
- Connectivity required for login, catalogue, quiz, Twin, consultations
- Do not replace cluster or rotate credentials for PP1 demos

## Startup (three terminals)

```powershell
# A — ML
cd backend\ml
.\.venv\Scripts\python.exe -m uvicorn arts_ai.inference.app:app --host 127.0.0.1 --port 8000

# B — API (do not override MONGODB_URI in the shell if .env is correct)
cd backend\api
node src\server.js

# C — UI
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/login`.

## Health / readiness

```powershell
Invoke-RestMethod http://127.0.0.1:4000/health
Invoke-RestMethod http://127.0.0.1:4000/ready
# After teacher login: GET /ml/ready
```

Expect Mongo Atlas identity `arts_ai`, ML `ready: true`, domain index loaded.

## Tests (on laptop when verifying)

```powershell
cd frontend
npm test
npm run build

cd ..\backend\api
node --test tests/frontend_gateway_extensions.test.js
```

## Demo accounts

See `DEMO_GUIDE.md` (`demo_stu` / `demo_tea` / `demo_admin`). Password is local demo only — do not print production secrets.
