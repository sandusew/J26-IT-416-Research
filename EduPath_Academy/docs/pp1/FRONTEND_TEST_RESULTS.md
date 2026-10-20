# PP1 frontend test results

Historical pass (2026-10-15) preserved below. **Current refresh: 2026-10-16.**

## Automated (2026-10-16)

| Suite | Category | Command | Result |
|-------|----------|---------|--------|
| Frontend vitest | Unit + component | `cd frontend && npm test -- --run` | **12 passed** / 4 files |
| Frontend production build | System build | `cd frontend && npm run build` | **pass** (`tsc -b` + vite) |
| Backend gateway ACL | Integration | `cd backend/api && node --test tests/frontend_gateway_extensions.test.js` | **3 passed** |

Logs: `docs/pp1/evidence/frontend_vitest.log`, `frontend_build.log`, `backend_gateway_acl_final.log`.

### Unit coverage added

- `frontend/src/lib/modelPanelSummary.test.ts` — C1/C2/C3/C4/recs outcome mapping (success vs incomplete vs fallback)

### Mocked vs live

| Kind | What |
|------|------|
| Mocked | Vitest UI/unit tests (jsdom) — no Atlas |
| Live integration | Gateway ACL + Express memory Mongo tests |
| Live system | Browser + Express `:4000` + FastAPI `:8000` + Atlas `arts_ai` |

## Browser / system (2026-10-16)

Base: `http://127.0.0.1:5173`

| Test ID | Category | Result | Evidence |
|---------|----------|--------|----------|
| SYS-ME-C1 | System | Pass — cluster 0 / `c1_20261013T030329_134eeb26` | screenshots + evidence |
| SYS-ME-C2E | System | Pass — P(correct)≈0.378 / EdNet v2 | browser + `c2_ednet.json` |
| SYS-ME-C2R | System | Pass — trainedScorerUsed=true historical | browser |
| SYS-ME-C2F | System | Pass — vocabulary fallback (not inference success) | browser |
| SYS-ME-C3 | System | Pass success + incomplete states | browser + evidence |
| SYS-ME-C4 | System | Pass — topic + TF-IDF→LR label | `model_explorer_c4_result.png` |
| SYS-QUIZ-TWIN | System | Pass — score 2/5, Twin v1, API restart | `twin_after_quiz.json` |
| SYS-CONSULT | System | Pass — approve, meetingUrl null, 409 conflict | consultation_*.json |
| SYS-ACL | System | Pass — student 403 on ML explorers | gateway tests + live |

## Historical automated (2026-10-15)

| Suite | Command | Result |
|-------|---------|--------|
| Frontend unit/component | `cd frontend && npm test` | **6 passed** (vitest) |
| Frontend production build | `cd frontend && npm run build` | **pass** |
| Frontend lint | `cd frontend && npm run lint` | **exit 0** |
| Backend gateway extensions | `node --test tests/frontend_gateway_extensions.test.js` | **3 passed** |

## Historical browser (2026-10-15)

| Step | Result |
|------|--------|
| Student login / dashboard meta 540 Q / 45 R | pass |
| Resource reader provenance | pass |
| Quiz Score 3/5 (prior run) | pass |
| Domain chat extractive + citations | pass |
| Teacher C1 cluster | pass |

Screenshots: `docs/pp1/screenshots/`.
