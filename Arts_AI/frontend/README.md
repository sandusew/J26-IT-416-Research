# Arts AI — React frontend (PP1)

Polished educational UI for the Arts AI Express gateway. Models and content stay on the backend; the browser never talks to Atlas or FastAPI directly.

## Stack

- React 19 + TypeScript + Vite 8
- Tailwind CSS 4
- React Router 7
- lucide-react, recharts
- Vitest + Testing Library

## Prerequisites

1. Express API on `http://127.0.0.1:4000` (Atlas `arts_ai` via `backend/api/.env`)
2. FastAPI ML on `http://127.0.0.1:8000`
3. Node 18+

## Environment

Copy `.env.example` → `.env` (optional).

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | Absolute Express base URL. Leave empty in dev to use Vite proxy `/api` → `:4000`. |

No secrets belong in frontend env files.

## Start (separate terminals)

```powershell
# Terminal A — backend\ml
.\.venv\Scripts\python.exe -m uvicorn arts_ai.inference.app:app --host 127.0.0.1 --port 8000

# Terminal B — backend\api
node src\server.js

# Terminal C — frontend
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/login`.

Demo users (password `pw` when first seeded): `demo_stu`, `demo_tea`, `demo_admin`.

## Scripts

```powershell
npm run dev
npm run build
npm run preview
npm test
npm run lint
```

## Roles

| Role | Notable routes |
|------|----------------|
| student | Dashboard, subjects, quiz, twin, progress, chat, consultations, peers, notifications |
| teacher / admin | Above (where owned) + Catalogue, Model Explorer |

## Evidence

See `docs/pp1/` for API mapping, demo guide, test results, and readiness checklist.
