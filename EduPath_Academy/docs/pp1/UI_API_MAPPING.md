# PP1 — UI to API mapping

Browser → Express gateway (`VITE_API_BASE_URL` or Vite `/api` proxy) → MongoDB Atlas / FastAPI.  
The browser never calls Atlas or FastAPI directly.

## Auth & shell

| Screen / action | Method | Path | Roles |
|-----------------|--------|------|-------|
| Login | POST | `/auth/login` | public |
| Session | GET | `/auth/me` | any authed |
| Teacher directory (consultations) | GET | `/auth/teachers` | any authed |
| Logout | client | clears token + cached user | — |

## Student learning

| Screen | Method | Path |
|--------|--------|------|
| Dashboard coverage | GET | `/catalogue/meta` |
| Progress | GET | `/learning/progress/:studentId` |
| Digital Twin | GET | `/learning/digital-twin/:studentId` |
| Recommendations (default) | GET | `/learning/recommendations/:studentId?policyMode=prerequisite_aware&catalogueMode=canonical&contentPolicy=published_practice` |
| Subjects / topics | static | `frontend/src/data/curriculum.en.json` (EN registry slice) |
| Resource list / reader | GET | `/catalogue/resources` |
| Assign practice quiz | POST | `/learning/quiz/:studentId/assign` |
| Get assignment | GET | `/learning/quiz/:studentId/assignments/:assignmentId` |
| Submit quiz | POST | `/learning/quiz/:studentId/assignments/:assignmentId/submit` |
| Domain chat | POST | `/ml/chat/:studentId/ask` (`corpus_mode=domain`) |
| Consultations (student) | GET/POST/PATCH | `/consultations/student/:id`, `/consultations`, `/consultations/:id/state` |
| Peer groups | POST | `/learning/peer-groups`, `…/join-request` |
| Notifications | GET | `/learning/notifications/me` |

## Teacher / admin

| Screen | Method | Path |
|--------|--------|------|
| Consultation inbox | GET | `/consultations/teacher/:teacherId` |
| Approve / decline / cancel | PATCH | `/consultations/:consultationId/state` |
| Catalogue browse | GET | `/catalogue/questions`, `/catalogue/resources` |
| Review (not publish-practice) | POST | `/catalogue/questions|resources/…/review` |
| Model Explorer readiness | GET | `/ml/ready` (any authed; versions from serving metadata) |
| C1 behaviour | POST | `/ml/behaviour/cluster` (**teacher/admin**) |
| C3 risk | POST | `/ml/risk/predict` (**teacher/admin**) |
| C2 EdNet correctness | POST | `/ml/correctness/predict` (**teacher/admin**) — public-domain next-answer correctness |
| C2 ranker score | POST | `/ml/recommendations/score` (**teacher/admin** diagnostic) |
| C4 topic classify | POST | `/ml/topic/classify` (**teacher/admin**) — TF-IDF→LogisticRegression |
| Ranker fallback demo | GET | `/learning/recommendations/:id?policyMode=trained_ranker&catalogueMode=canonical` |

Quiz submit persists ProgressSnapshot **and** Digital Twin `observed_topic_performance` (server aggregates; not Model Explorer demos).

## Content policy

- Default learner policy: `published_practice` (AI-authored published practice; not teacher-approved).
- Strict mode: `teacher_reviewed_only` excludes unreviewed practice.
- Fixtures require server `ARTS_AI_ALLOW_TEST_FIXTURES` — UI does not enable fixture corpus for students.

## Backend additions for PP1 (minimal)

| Addition | Purpose |
|----------|---------|
| `GET /auth/teachers` | Consultation teacher picker |
| `GET /consultations/teacher/:teacherId` | Teacher inbox |
| `POST /ml/correctness/predict` | Staff Model Explorer |
| `POST /ml/topic/classify` | Staff Model Explorer |
| `POST /ml/recommendations/score` | Staff diagnostic (does not change default rec policy) |
