# Content policy — fixtures vs practice vs teacher-reviewed

## Axes (independent)

| Axis | Meaning |
|------|---------|
| `contentOrigin` | `authentic_public` / `ai_authored_source_grounded` / `teacher_authored` / fixture origin |
| `isTestFixture` | Isolated test/demo data only |
| `automatedValidation` | `passed` / `failed` / `pending` / `not_run` |
| `humanReviewStatus` | `unreviewed` / `teacher_approved` / `teacher_rejected` |
| `reviewStatus` | Catalogue workflow; `approved_for_learner` **only** via review endpoint |
| `learnerAvailability` | `draft` / `published_practice` / `internal` / `retired` |

## Policies

| `ARTS_AI_CONTENT_POLICY` | Learner eligibility |
|--------------------------|---------------------|
| `published_practice` (default local) | Non-fixture + `automatedValidation=passed` + `learnerAvailability=published_practice` |
| `teacher_reviewed_only` | `reviewStatus=approved_for_learner` only |

Learner-facing responses label AI-authored items as **not teacher-reviewed**.

## Forbidden

- Import setting `approved_for_learner`
- Publishing fixtures as practice
- Counting practice publication as authentic or teacher-reviewed coverage
- Relabelling historical fixtures by removing flags

## Repaired practice bank (2026-10-15)

After structural/source-heuristic audit, eligible published practice counts may be **below** the original 540 authoring target. Superseded drafts remain for history; new assignments use published repaired versions only. Publication still never sets teacher approval.

**Deficit-fill 2026-10-15:** Published practice bank is **540** distinct questions (45 topics × 12). Verify with 
ode scripts/verify_populated_backend.js and 
ode scripts/verify_topic_quiz_capacity.js. Index c4_index_20261014T173535_894e48ef unchanged. Live gen/meeting still blocked≠pass.
