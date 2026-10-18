# Final UI acceptance (PP1)

Date: 2026-10-16  
Scope: Arts AI React UI ↔ Express ↔ Atlas + FastAPI serving  
Official client rubric: **absent → official rubric compliance unconfirmed**

## Verdict

**PP1 UI/backend verification for the scoped workflows is complete on this machine.** Live generative LLM and live meeting providers remain unconfigured (not claimed as passed). Practice content remains AI-authored / not teacher-reviewed. Models are experimental public/synthetic tracks — not validated A/L predictors.

## Model Explorer (staff)

| Panel | Served version (response) | Result | Evidence |
|-------|---------------------------|--------|----------|
| C1 behaviour cluster | `c1_20261013T030329_134eeb26` | Success — cluster_id **0** | Browser + `evidence/c1_cluster.json` |
| C2 EdNet correctness | `c2_ednet_v2_20261013T153128_f83023f6` | Success — P(correct)≈**0.378** (not learning effectiveness) | Browser + `evidence/c2_ednet.json` |
| C2 EdNet invalid | — | Expected **422** | `evidence/c2_ednet_invalid.json` |
| C2 ranker historical | `c2_rank_rev_20261013T105157_40d91e8c` | Success — `trainedScorerUsed=true`, scores 0.4644 / 0.4068 | Browser + `evidence/c2_rank_historical.json` |
| C2 Arts catalogue path | `prerequisite_aware_v0` | Expected fallback — `topic_vocabulary_incompatible_canonical_catalogue` | Browser + `evidence/recs_trained_canonical_fallback.json` |
| C3 risk (complete) | `c3_oulad_20261013T030421_2f6e0ea2` | Success — P(Fail)≈0.180, band low | `evidence/c3_risk.json` |
| C3 incomplete observation | same artifact | Expected incomplete — not inference success | Browser + `evidence/c3_incomplete.json` |
| C4 topic classify | `c4_topic_nl_20261013T105116_04964504` | Success — topic `sub_history_t06`; architecture TF-IDF→LR (confidence not returned) | Browser screenshot + `evidence/c4_topic.json` |

Unsupported Arts-domain risk and empty C4 input exercised as validation/unsupported outcomes (≠ successful inference).

## Student / teacher workflows

| Workflow | Result |
|----------|--------|
| Quiz assign (keys absent) | Pass |
| Quiz submit score **2/5** (prehistoric topic) | Pass — recorded actual |
| Duplicate submit | Pass — `already_submitted`, no re-apply |
| Progress attempts persist (53→58→63) | Pass |
| Twin observed performance after submit | Pass after fix — profile v1 |
| Twin persist after API restart | Pass |
| Recommendations canonical published practice | Pass |
| Consultation request → teacher approve | Pass — `meetingUrl: null`, unconfigured |
| Scheduling conflict | Pass — 409 |
| Asia/Colombo display | Pass (e.g. Oct 19, 2026, 9:03 AM) |
| Student blocked from Model Explorer ML proxies | Pass — 403 including C1/C3 |
| Cross-student progress | Pass — 403 |

## Tests (this pass)

| Category | Command | Totals |
|----------|---------|--------|
| Unit + component | `cd frontend && npm test` | **14 passed** (chat failure/retry added) |
| Build / typecheck | `cd frontend && npm run build` | pass |
| Integration (API ACL) | `cd backend/api && node --test tests/frontend_gateway_extensions.test.js` | **3 passed** |
| System / browser | cursor-ide-browser against :5173/:4000/:8000/Atlas | Model Explorer A–E + twin UI documented |

Historical frontend results (6 tests) preserved in earlier `FRONTEND_TEST_RESULTS.md` sections; current run is 12 (added `modelPanelSummary` tests).

## Remaining external dependencies

- Live LLM generation credentials / smoke
- Live meeting provider + smoke JSON
- Teacher educational validation of practice bank
- Official NIE LO extracts; Sinhala Literature deferred
- Client laptop physical run (`CLIENT_LAPTOP_SETUP.md` = instructions prepared only)

## Stabilization pass (2026-10-16 afternoon)

- Digital Twin student view shows topic names, average marks, attempt counts, last update, and demo-account wording. Raw JSON and internal provenance strings are removed from that screen.
- Teachers receive 403 on learner progress/twin/quiz routes when using another student’s id.
- Consultation state changes write one student notification (`ntf_con_*`).
- Peer groups list and join are available in the UI; duplicate pending joins return 409.

## Concurrency and workflow pass (2026-10-16)

- Twin updates use a per-learner revision. The revision is captured before attempts are read, and the write succeeds only if that revision is still current. A newer assignment cannot be overwritten by an older snapshot.
- The mobile header shows a menu at 390px, closes on Escape, backdrop, and route selection, and keeps logout available.
- Peer approval is limited to the owner, a moderator, or an admin. The owner can approve from the peer groups page.
- Consultation updates use PATCH. A repeated state change restores a missing student notification without a second record. `meetingUrl` stays null while meetings are unconfigured.
- A failed chat request restores the question and does not keep an assistant turn. A later success adds one turn. Domain chat does not switch to fixtures.
- `ML_BASE_URL` is accepted when `ML_INFERENCE_URL` is unset.

Live generation and live meetings remain unconfigured.

## Explicit non-claims

- Not full research or educational validation
- Expected unsupported/incomplete responses ≠ successful model inference
- Successful build ≠ browser verification (both done separately here)
- Meeting / generation live verification **not passed**
