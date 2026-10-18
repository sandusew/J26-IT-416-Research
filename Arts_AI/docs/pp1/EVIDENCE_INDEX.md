# PP1 evidence index

Updated: 2026-10-16 (local Arts AI verification). Does not replace historical evidence; adds current paths.

## Automated logs

| Path | What |
|------|------|
| `docs/pp1/evidence/frontend_vitest.log` | Vitest (12 passed) |
| `docs/pp1/evidence/frontend_build.log` | `tsc -b` + Vite production build |
| `docs/pp1/evidence/backend_gateway_acl.log` | Staff ML ACL tests (3 passed) |
| `docs/pp1/evidence/backend_gateway_acl_final.log` | Re-run after C1/C3 staff lock |
| `docs/pp1/evidence/env_versions.txt` | Node / npm / Python / git tip |

## Model Explorer (API + browser)

| Path | Panel |
|------|-------|
| `docs/pp1/evidence/c1_cluster.json` | C1 OULAD cluster |
| `docs/pp1/evidence/c2_ednet.json` | C2 EdNet correctness |
| `docs/pp1/evidence/c2_ednet_invalid.json` | C2 invalid body (422) |
| `docs/pp1/evidence/c2_rank_historical.json` | C2 ranker historical T01/T02 |
| `docs/pp1/evidence/c2_rank_arts.json` | Score endpoint with Arts topic IDs (feature-only) |
| `docs/pp1/evidence/recs_trained_canonical_fallback.json` | Learner path vocabulary fallback |
| `docs/pp1/evidence/c3_risk.json` | C3 OULAD risk success |
| `docs/pp1/evidence/c3_incomplete.json` | C3 incomplete observation |
| `docs/pp1/evidence/c3_missing_obs.json` | C3 missing completeness |
| `docs/pp1/evidence/c4_topic.json` | C4 topic classify |
| `docs/pp1/evidence/c4_empty.json` | C4 empty text rejection |
| `docs/pp1/evidence/PP1_VERIFICATION_SUMMARY.txt` | Short panel summary |

## Quiz → progress → Twin

| Path | What |
|------|------|
| `docs/pp1/evidence/quiz_assign.json` | Assign without answer keys |
| `docs/pp1/evidence/quiz_submit.json` / `quiz_submit_twin_sync.json` | Submit scores |
| `docs/pp1/evidence/quiz_submit_idempotent.json` | `already_submitted` |
| `docs/pp1/evidence/twin_after_quiz.json` | Twin profile after submit |
| `docs/pp1/evidence/quiz_twin_after_api_restart.json` | Persistence after API restart |
| `docs/pp1/evidence/progress_demo_s0001.json` | Progress snapshots |

## Consultations / ACL

| Path | What |
|------|------|
| `docs/pp1/evidence/consultation_request.json` | Student request |
| `docs/pp1/evidence/consultation_approved.json` | Approved, `meetingUrl: null` |
| `docs/pp1/evidence/consultation_conflict.json` | 409 conflict |
| `docs/pp1/evidence/auth_teachers.json` | Teacher list fields |
| `docs/pp1/evidence/notifications_student.json` | `/learning/notifications/me` |

## Screenshots

| Path | Scene |
|------|-------|
| `docs/pp1/screenshots/model_c1_cluster.png` | Model Explorer (C1 area) |
| `docs/pp1/screenshots/model_explorer_c4_result.png` | C4 predicted topic + architecture |
| `docs/pp1/screenshots/student_twin_after_quiz.png` | Twin observed performance |
| `docs/pp1/screenshots/desktop_resource_reader.png` | Prior resource reader |
| `docs/pp1/screenshots/desktop_model_explorer.png` | Prior Model Explorer |

## Manifest

Refresh last when serving/content state changes:  
`backend/ml/.venv/Scripts/python.exe backend/ml/scripts/generate_current_state_manifest.py`
