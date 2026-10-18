# Practice content quality report

Generated: 2026-10-15T04:02:44.724125+00:00

## Deficit fill (v3)
- Distinct eligible questions: **540**
- Topics meeting ≥12 distinct: **45/45**
- Newly authored: **145**
- Dropped duplicate/boilerplate: **100**
- Blockers: **0**

## Reconciliation
Prior 531 batch rows included duplicate questionId::version keys (45 dupes → 486 unique). This fill dedupes and authors new distinct IDs to reach 12/topic where sources allow.

## Review kinds
- Performed: structural_schema, near_duplicate_jaccard, boilerplate_grounding_filter, source_support_heuristic, distinct_logical_id_check
- Not performed: teacher_factual_validation, psychometric_calibration, official_past_paper_provenance_check
