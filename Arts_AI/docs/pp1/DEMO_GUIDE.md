# PP1 demo guide

## Start (three terminals)

```powershell
# A — backend\ml
.\.venv\Scripts\python.exe -m uvicorn arts_ai.inference.app:app --host 127.0.0.1 --port 8000

# B — backend\api  (Atlas via .env; do not override MONGODB_URI in shell)
node src\server.js

# C — frontend
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/login`.

| User | Password | Role |
|------|----------|------|
| `demo_stu` | `pw` | student |
| `demo_tea` | `pw` | teacher |
| `demo_admin` | `pw` | admin |

## Student flow (AI-authored practice)

1. Login as `demo_stu`.
2. Dashboard — live `/catalogue/meta` coverage (not hardcoded).
3. Subjects → History → open a resource — badges show **AI-authored practice** / **Not teacher-reviewed**.
4. Practice quiz — assign 5 questions on a topic; answer; Submit once → server score (e.g. `Score: 3 / 5`).
5. Progress / Digital Twin — refresh after quiz.
6. Arts chat — domain corpus; expect `answer_type: extractive_template` and citations.
7. Consultations — request slot with a teacher from `/auth/teachers`; Join only if `meetingUrl` is http(s).

## Teacher / Model Explorer (public-data demos)

1. Login as `demo_tea`.
2. Catalogue — browse questions/resources; review requires evidence (does not publish-practice).
3. Model Explorer — each panel has **Load public-data example** + **Run inference**:
   - C1 OULAD cluster → show cluster ID + `model_version`
   - C3 OULAD risk (not A/L exam failure) — also incomplete / Arts-unsupported examples
   - C2 EdNet next-answer correctness (not Arts IDs; not learning effectiveness)
   - C2 ranker historical score (`trainedScorerUsed=true`) + separate **canonical Arts fallback** panel
   - C4 closed-set topic classify (TF-IDF → LogisticRegression hint; confidence only if returned)

Versions come from `GET /ml/ready` / response metadata, not hardcoded UI run IDs. Demo inputs are **not** written to student Twin profiles.

## Providers

- Generation: extractive domain chat works without LLM credentials.
- Meeting: booking works with `meetingUrl=null` when unconfigured.
