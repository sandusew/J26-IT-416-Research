# Arts AI — API Guide

## Services

| Service | Stack | Default URL |
|---------|-------|-------------|
| Express gateway | Node / Express / MongoDB | `http://127.0.0.1:4000` |
| ML inference | FastAPI | `http://127.0.0.1:8000` |

Start from repo root in **separate terminals** (see `LOCAL_SETUP.md`).

## Recommendations

`GET /learning/recommendations/:studentId?subjectId=&policyMode=&limit=`

| `policyMode` | Behaviour |
|--------------|-----------|
| `prerequisite_aware` (**default**) | Prerequisite eligibility + heuristic score |
| `trained_ranker` | Same eligibility; scores via `POST /v1/recommendations/score` |

Response: `policyMode`, `trainedScorerUsed`, `modelVersion`, `fallbackReason`, `recommendations[]`.

## Chat

ML: `POST /v1/chat/ask` — **default `corpus_mode=domain`**.

```json
{
  "student_id": "syn_s0000",
  "question": "…",
  "digital_twin": {},
  "conversation_history": [],
  "use_generation": true,
  "corpus_mode": "domain",
  "subject_id": "sub_history",
  "language": "en"
}
```

| `corpus_mode` | Behaviour |
|---------------|-----------|
| `domain` (**default**) | Domain BM25 index; unavailable → structured insufficient-evidence (**no fixture fallback**) |
| `fixture` | Generated index — requires `ARTS_AI_ALLOW_TEST_FIXTURES=true` on **both** API and ML processes; production **403** |

Response includes `answer_type`, `corpus_mode`, `corpus_version`, `corpus_provenance`, `citations`, `insufficient_evidence`, `unsupported_language`, `generation`.

Gateway: `POST /ml/chat/:studentId/ask` (ownership). Fixture history turns are stripped from domain conversations. Twin personalization uses authentic aggregates only.

Topic classify: NL serving via `LATEST_TOPIC_SERVING`. Does not gate domain retrieval.

## Correctness / behaviour / risk / twin

- `POST /v1/correctness/predict` — EdNet v2
- `POST /v1/behaviour/cluster` — C1
- `POST /v1/risk/predict` — C3 OULAD days 0–13. Requires explicit `observation` metadata. Statuses include `no_observation_data`, `incomplete_observation_window`, `insufficient_data` (completeness not asserted), `ok_zero_activity` (complete window, zero VLE events; recency=cutoff+1 per training), `ok`, `unsupported_application_domain`. `experimental_domain_transfer` does **not** bypass missing features.
- `GET /learning/recommendations/:studentId` — default `prerequisite_aware`. Opt-in `policyMode=trained_ranker` scores **historical synthetic** topics only. `catalogueMode=canonical` → fallback with `topic_vocabulary_incompatible_*`; `trainedScorerUsed=true` only when the saved model scored compatible inputs.
- `POST /learning/digital-twin/:studentId/update` — persists `curriculum_version`, `enrolled_subjects`, `observed_topic_performance` (distinct from estimated mastery / OULAD cluster)
- `POST /ml/chat/:studentId/ask` — forwards `corpus_mode`, `subject_id`, `language` to FastAPI (no silent domain→fixture fallback)

## Curriculum

- Registry: `backend/ml/data/curriculum/nie_al_arts_provisional_v0.1_registry.json` (provisional)
- Coverage: `backend/ml/reports/curriculum_coverage_matrix.json`
- Catalogue import templates: `backend/ml/data/curriculum/import_templates/`
- Review package (provisional technical slice): `backend/ml/data/curriculum/review_packages/hist_sl_rajarata_politics_v0/`
- Requirements matrix: `REQUIREMENTS_TO_IMPLEMENTATION.md`

## Fixture isolation (server-side)

| Rule | Behaviour |
|------|-----------|
| Default | Fixtures excluded from assign, recommendations, learner resources, staff lists |
| Enable demos | `ARTS_AI_ALLOW_TEST_FIXTURES=true` **and** `NODE_ENV≠production` **and** client `allowTestFixtures`/`includeFixtures` |
| Production | Always **403** `fixtures_not_enabled` even if the client requests fixtures |
| Counts | `/catalogue/meta` separates authentic vs fixture approved; progress separates authentic vs fixture attempts |
| Reviewer | JWT identity only — import/PATCH cannot approve or set `reviewerId` |

## Canonical catalogue (staff)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/catalogue/import` | Teacher/admin. Default dry-run; `dryRun=false` to persist. Optional `atomic=true` aborts persist on any validation error. Rejects `partial_match` and import-time `approved_for_learner`. Idempotent hash; version conflicts explicit. |
| GET | `/catalogue/questions` | Staff; answer keys omitted unless `includeKeys=true`. Fixtures need server policy + `includeFixtures=true`. |
| POST | `/catalogue/questions/:qid/versions/:v/review` | `approved_for_learner` / `rejected` / `pending_review` / `retired` + `reviewEvidence` for approve. |
| PATCH | `/catalogue/questions/:qid/versions/:v` | Scoring-critical edits on approved items → `pending_review`. Cannot approve via PATCH. |
| GET | `/catalogue/meta` | `nApprovedNonFixtureQuestions` vs `nApprovedFixtureQuestions`. |

## Canonical quiz (learners)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/learning/quiz/:studentId/assign` | Eligibility filters; one version per `questionId`; fixtures only under server policy. **409** `canonical_question_bank_unavailable` or **403** `fixtures_not_enabled`. No synthetic substitution. |
| POST | `/learning/quiz/:studentId/assignments/:assignmentId/submit` | Durable claim with pending payload fingerprint + lease; frozen scoring; ownership; concurrent/duplicate → **409**; recoverable after crash via retry or `POST /learning/quiz/recover-stuck-submissions` (staff). |
| POST | `/learning/quiz/recover-stuck-submissions` | Teacher/admin — completes expired `submitting` leases from `pendingResponses` (does **not** blindly reset to assigned). |
| GET | `/learning/quiz/:studentId/assignments/:assignmentId` | Student view without answer keys; cross-student → **404**. |

Direct `POST /learning/quiz/:id/submit` with a canonical topic under NIE curriculum returns **409** (`canonical_assignment_required` or `canonical_question_bank_unavailable`).



## Practice content policy

Default learner catalogue policy: ARTS_AI_CONTENT_POLICY=published_practice (see CONTENT_POLICY.md).

| Method | Path | Notes |
|--------|------|-------|
| POST | /catalogue/questions/:id/versions/:v/publish-practice | Staff; requires utomatedValidation=passed, exact hash; **does not** set teacher approval |
| POST | /catalogue/resources/:id/versions/:v/publish-practice | Same for resources |
| POST | /catalogue/publish-practice/eligible | Bulk publish validated drafts |
| GET | /catalogue/meta | coverage breaks out authentic / published practice / fixtures / teacher-reviewed |

Assign/recommendations: pass contentPolicy=published_practice (default) or 	eacher_reviewed_only. Learner responses include provenance labels (AI-authored, not teacher-reviewed).

Populated practice bank (implementation assumption): 45 EN topics, 540 AI-authored questions, 45 packages. Authentic approved remains 0.

## Meeting

URLs stay `null` unless provider configured **and** smoke-tested. See `MEETING_INTEGRATION.md`.

## Demo sequence (expected fields)

1. `GET /ready` → `serving.topic_classifier.run_id` = NL run; `knowledge_domain_index.status`
2. Login → token
3. Recommendations default → `policyMode=prerequisite_aware`, `trainedScorerUsed=false`
4. `?policyMode=trained_ranker` → `trainedScorerUsed=true`, `modelVersion=c2_rank_rev_…` (ML up)
5. Chat `corpus_mode=domain` → `corpus_version=c4_index_…`, citations with `document_id`
6. Consultation approve → `meetingUrl=null` when unconfigured

## Tests

```powershell
cd <repo>\backend\api
$env:ML_INFERENCE_URL='http://127.0.0.1:8000'
node --test tests\integration.test.js
node --test tests\canonical_catalogue.test.js
node --test tests\meeting_provider_contract.test.js
node tests\trained_ranker_live_smoke.js

cd <repo>\backend\ml
.\.venv\Scripts\python.exe scripts\eval_domain_retrieval.py
.\.venv\Scripts\python.exe scripts\audit_retrieval_eval.py
```

Historical logs (do not overwrite attribution): `integration_final_8of8.log` (8), `integration_post_rec_policy.log` (9), `integration_post_nl_serving.log` (11).

**Handoff 2026-10-15:** Atlas DB arts_ai via `.env`; verify with `node scripts/verify_populated_backend.js`. Published practice after quality repair is tracked in `/catalogue/meta` coverage (not forced to 540). Live gen/meeting still blocked≠pass.

**Deficit-fill 2026-10-15:** Published practice bank is **540** distinct questions (45 topics × 12). Verify with 
ode scripts/verify_populated_backend.js and 
ode scripts/verify_topic_quiz_capacity.js. Index c4_index_20261014T173535_894e48ef unchanged. Live gen/meeting still blocked≠pass.
