# Continuation — practice deficit-fill closeout (2026-10-15)

## Defects fixed
- Duplicate `questionId::version` keys in combined batch (531 rows → 486 unique).
- Misreported “36/45 topics ≥12” based on row counts, not distinct logical IDs.
- Per-topic shortfalls (54 slots across 34 topics) filled with wiki-grounded AI practice (145 new items).
- Boilerplate-grounded items dropped when real extracts available.

## Counts
- Published distinct questions: **540**; resources: **45**; topics ≥12: **45/45**.
- Index: `c4_index_20261014T173535_894e48ef` unchanged (package bodies match chunks).

## Evidence
- `practice_bank_reconciliation.json`, `practice_deficit_fill.json`, `practice_republish.json`
- `topic_quiz_capacity.json` (45/45), verify 20/20, demo E2E 26/26
