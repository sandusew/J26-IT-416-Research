# Requirements-to-implementation matrix

## Document authority

| Source | Class | Role |
|--------|-------|------|
| Approved proposal / client guideline PDF | **Approved requirements** | **NOT FOUND in workspace** |
| Component SRS / RFP | Approved | **NOT FOUND** |
| `README.md` | Project framing | Component names only |
| `SYNTHETIC_DATA_SPEC.md` / `synthetic_arts.yaml` | Draft/provisional | Generated catalogue — not syllabus approval |
| Implementation reports / continuation reports | AI/implementation summaries | Evidence of code state, not approval |
| NIE public syllabi (URLs in `SCOPE_DECISIONS.md`) | Official curriculum **structure** references | Topic titles/units; teaching-text reuse unclear |

**Gap:** Without the approved proposal, requirement IDs below are **provisional** (`PROV-*`), derived from README component names and standard research expectations for this platform. They must be reconciled when the official guideline is supplied.

## Component requirements (provisional)

| Req ID | Source | Component | Required behavior | Model/method | Data | Current implementation | Evidence | Remaining gap |
|--------|--------|-----------|-------------------|--------------|------|------------------------|----------|---------------|
| PROV-C1-01 | README §Components | C1 | Behaviour clustering / Twin | K-Means (OULAD experiment) | OULAD VLE days 0–13 | Serving OULAD K-Means | MODEL_STATUS; artifacts/c1 | Local Arts validation absent |
| PROV-C1-02 | README | C1 | Persist Twin with curriculum context | Application contract | App events | Twin stores curriculum_version, enrolled subjects, observed topic performance, distinct mastery/cluster fields | learning.js digital-twin update | Mastery estimator not trained; awaiting labels |
| PROV-C2-01 | README | C2 | Personalized recommendations | Prerequisite policy + optional ranker | Synthetic catalogue | Default prerequisite_aware; trained_ranker opt-in for synthetic only; canonical → fallback | API_GUIDE; integration | Ranker incompatible with canonical topic IDs |
| PROV-C4-NL | Implementation artifact | C4 (shared hint) | Closed-set topic classify | **TF-IDF + LogisticRegression** (not DistilBERT) | Generated closed-set | Serving NL run | MODEL_IDENTITIES | Must not hard-gate domain chat |
| PROV-C2-02 | README | C2 | Correctness modelling (public track) | EdNet v2 logistic | EdNet subset | Serving EdNet v2 | MODEL_STATUS | Not Arts item IDs/difficulty |
| PROV-C2-03 | README | C2 | Diagnostics / quizzes | Rule scoring | Synthetic questions | Quiz assign/submit | integration tests | No teacher-reviewed curriculum question bank |
| PROV-C3-01 | README | C3 | Academic risk | OULAD risk model | OULAD | Serving risk pipeline | MODEL_STATUS | App inputs often insufficient for OULAD features — must not invent |
| PROV-C3-02 | README | C3 | Progress analytics | Summaries | Quiz/diagnostic events | `/learning/progress` | learning.js | Not exam-failure prediction |
| PROV-C4-01 | README | C4 | Context-aware chatbot | RAG + optional generation | Domain/fixture indexes | Dual corpus_mode; citations | API_GUIDE | Domain corpus supplemental; awaiting teacher review |
| PROV-C4-02 | README | C4 | Teacher consultation | Booking + meeting | Synthetic teachers | Conflict/ownership; meeting adapter | MEETING_INTEGRATION | Live meeting awaiting provider/creds |
| PROV-C4-03 | README | C4 | Peer groups | Capacity/approval | App DB | Implemented | integration tests | — |
| PROV-CUR-01 | Client expectation (this phase) | All | Canonical curriculum registry | Registry | NIE structure refs | `nie_al_arts_provisional_v0.1` | curriculum registry JSON | Stakeholder confirmation of scope |
| PROV-CUR-02 | This phase | All | Syllabus coverage measurement | Coverage matrix | Registry+corpus | Reports generated | curriculum_coverage_* | Teaching material / review denominators low |

## Decisions required from stakeholders

1. Supply approved proposal/guideline into the repo.
2. Confirm subject list, media, grades, syllabus edition/cohort (`SCOPE_DECISIONS.md`).
3. Authorize NIE teaching-text reuse or provide teacher-authored materials.
4. Provide credentials for live generation/meeting if required for viva.
