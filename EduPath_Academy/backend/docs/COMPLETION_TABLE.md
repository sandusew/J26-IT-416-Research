# Arts AI — Component Completion Table

| Component | Implemented | Trained | Experimentally evaluated | Externally configured | Notes |
|-----------|-------------|---------|--------------------------|----------------------|-------|
| C1 Behaviour / Twin | Yes | Yes (OULAD) | Public OULAD | N/A | Twin stores curriculum fields; mastery not trained |
| C2 EdNet correctness | Yes | Yes (v2) | Public EdNet | N/A | ≠ Arts item IDs |
| C2 Arts recommendations | Yes | Ranker synthetic **LR** | Simulation | Policy env | Serving `StandardScaler→LogisticRegression`; canonical → prerequisite fallback |
| C3 OULAD risk | Yes | Yes | Public OULAD | N/A | Missing vs zero observation contract |
| C4 fixture RAG | Yes | Index | Fixture suites | N/A | extractive default |
| C4 domain RAG | Yes | Index (not LM) | Hit@3 7/8 + Recall@3 11/29 on `894e48ef` | Awaiting teacher review | Includes AI practice packages + wiki; Sinhala unsupported |
| C4 Topic NL | Yes | TF-IDF+LR | Closed-set | N/A | **Not DistilBERT**; does not hard-gate domain chat |
| Curriculum registry/coverage | Yes (provisional) | N/A | Coverage matrix + practice coverage | Scope unconfirmed | 45 EN packages; authentic approved Q **0**; Sinhala lit deferred |
| Catalogue import + review + publish-practice | Yes (Mongo) | N/A | Fixture 11 + practice pub 5 | Practice bank published | Teacher approval still review-only; practice ≠ authentic |
| Canonical quiz assign/submit | Yes | N/A | Fixture + practice E2E | Practice bank live | `contentPolicy=published_practice` default; strict mode empty |
| Fixture isolation | Yes | N/A | Catalogue + chat + Twin | `ARTS_AI_ALLOW_TEST_FIXTURES` on API **and** ML | Default chat=domain; client flag alone cannot enable fixtures |
| Quiz submit recovery | Yes | N/A | 4 recovery tests | N/A | Lease + pending fingerprint; staff recover script |
| Generation live smoke | Script ready | N/A | Offline blocked≠pass | Awaiting credentials | `scripts/smoke_generation_live.py --live` |
| Meeting live smoke | Script ready | N/A | Offline blocked≠pass | Awaiting provider | `scripts/smoke_meeting_live.js --live` |
| C4 generation | Adapter | N/A | Offline | Awaiting credentials | `ml/.env` then `api/.env` |
| Consultations / meeting | Booking + webhook | N/A | Contract tests | Awaiting provider | No fabricated URLs |
| Express gateway | Yes | N/A | Integration + meeting + catalogue suites | Mongo/MMS | Chat filters forwarded |

**Not claimed:** full syllabus coverage; authentic teacher review; institutional validation; DistilBERT; LightGBM serving ranker; live gen/meeting; Sinhala QA; A/L exam-failure prediction.

## Handoff note 2026-10-15

| Item | Status |
|------|--------|
| Atlas DB `arts_ai` via `.env` | Connected; shell URI override suppressed unless `ARTS_AI_MONGO_URI_SOURCE=shell` |
| Published practice questions (eligible) | **486** after quality repair (not forced to 540) |
| Published learning resources | **45** |
| Topics assignable under published_practice | **45/45** |
| Authentic / teacher-reviewed | **0** |
| Domain index | `c4_index_20261014T173535_894e48ef` |
| verify_populated_backend | 20/20 |
| demo_populated_e2e | 26/26 |
| Live gen / meeting providers | blocked_missing_configuration (not a pass) |

## Deficit-fill closeout 2026-10-15

| Item | Status |
|------|--------|
| Published distinct practice questions | **540** (12×45) |
| Topics meeting ≥12 distinct published Q | **45/45** |
| Published resources | **45** |
| 531→486 discrepancy | 45 duplicate batch keys; fixed by dedupe+fill |
| Domain index | unchanged c4_index_20261014T173535_894e48ef |
| topic_quiz_capacity | 45/45 |
| verify / demo E2E | 20/20 / 26/26 |
