# Curriculum coverage summary (nie_al_arts_provisional_v0.1)

Generated: 2026-10-14T00:22:58.863832+00:00

Provisional in-scope topics (excl. placeholders): **45**

Denominator is the provisional demo scope (nie_al_arts_provisional_v0.1), not a verified complete national A/L Arts syllabus.

## Counting rules

- Unit = unique `topic_id` in provisional scope.
- `partial_match` / `unmapped` synthetic catalogue items are **not** verified curriculum coverage.
- Question/document/eval-case counts ≠ unique-topic coverage.

| Category | Numerator / Denominator |
|----------|-------------------------|
| registry_structure_recorded | 45 / 45 |
| official_learning_outcomes_recorded | 0 / 45 |
| draft_or_inferred_learning_outcomes | 45 / 45 |
| supplemental_teaching_content_mapped | 15 / 45 |
| learning_outcomes_supported_by_content | 11 / 45 |
| synthetic_draft_questions_partial_mapped | 32 / 45 |
| synthetic_draft_resources_partial_mapped | 32 / 45 |
| verified_curriculum_aligned_questions | 0 / 45 |
| verified_curriculum_aligned_resources | 0 / 45 |
| teacher_reviewed_content | 0 / 45 |
| retrieval_evaluation_coverage | 13 / 45 |

## By subject

- **sub_economics**: topics=8; supplemental_content=4/8; teacher_reviewed=0/8; verified_questions=0/8
- **sub_geography**: topics=8; supplemental_content=3/8; teacher_reviewed=0/8; verified_questions=0/8
- **sub_history**: topics=14; supplemental_content=4/14; teacher_reviewed=0/14; verified_questions=0/14
- **sub_political**: topics=15; supplemental_content=4/15; teacher_reviewed=0/15; verified_questions=0/15

## By grade

- **grade 12**: topics=38; supplemental_content=13/38
- **grade 13**: topics=7; supplemental_content=2/7

## By medium

- **english**: topics=45; supplemental_content=15/45

Missing permitted teaching material for **30** topics (see matrix `missing_permitted_teaching_material`).

Do not report 100% syllabus coverage. Official LO text, teacher review, and verified curriculum-aligned assessment remain essentially empty under current evidence.

**Canonical catalogue workflow** is implemented and fixture-tested (`isTestFixture`) under **server-side** `ARTS_AI_ALLOW_TEST_FIXTURES` (client flag alone cannot enable fixtures). Authentic approved question/resource counts remain **0** and must not be inflated by test fixtures. Technical demo slice `hist_sl_rajarata_politics` is provisional — not final subject approval. Retrieval eval bound to index `c4_index_20261014T002208_333d545a`: Hit@3 6/8, Recall@3 micro 7/16 (`c4_retr_eval_20261014T005538_f17e0e8b`).

Machine-readable: `backend/ml/reports/curriculum_coverage_matrix.json`

## Practice bank quality repair (2026-10-15)

- Eligible published AI-authored questions after repair: see `backend/ml/reports/practice_content_quality.md` and Atlas `/catalogue/meta` coverage.
- Authentic approved / teacher-reviewed remain **0**.
- All 45 English working-scope topics assignable under `published_practice`.
- Retrieval metrics across different gold sets are **not** directly comparable (`backend/ml/reports/retrieval_eval_comparability.md`).

## Deficit-fill closeout (2026-10-15)

- Published distinct AI-authored practice questions: **540** (12 per topic × 45 English topics).
- Prior 531/486 mismatch was duplicate questionId::version keys in the import batch, not unpublished valid items.
- Authentic approved / teacher-reviewed remain **0**.
- Serving index unchanged; teaching packages consistent with index (ackend/ml/reports/teaching_index_consistency.json).
