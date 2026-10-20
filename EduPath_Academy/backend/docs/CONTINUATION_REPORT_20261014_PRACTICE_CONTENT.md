# Continuation report — 2026-10-14 populated practice content

Supersedes chat-recovery report for the content-population phase.

## Implementation assumption (not stakeholder approval)

Working scope = provisional registry English topics for History, Geography, Political Science, Economics. Sinhala Literature deferred. Not verified complete national syllabus coverage.

## What was delivered

| Item | Result |
|------|--------|
| Teaching packages | **45/45** in-scope topics (`practice/packages/*/`) |
| AI-authored questions | **540** (12/topic), validated, `isTestFixture=false` |
| Authentic approved Q/R | **0** (unchanged — not forged) |
| Teacher-reviewed | **0** |
| Published practice | 540 questions + 45 resources via `publish-practice` |
| Domain index | `c4_index_20261014T173535_894e48ef` (61 docs, 295 chunks) |
| Content policy | `published_practice` (default) vs `teacher_reviewed_only` |

## Policy axes (kept independent)

- `contentOrigin` (e.g. `ai_authored_source_grounded`)
- `isTestFixture`
- `automatedValidation`
- `humanReviewStatus` / `reviewStatus` (teacher approval only via review endpoint)
- `learnerAvailability=published_practice`

Import cannot forge `approved_for_learner`. Publication does not increase authentic/teacher-reviewed counts.

## Verification

- Practice publication tests: 5/5
- Populated E2E demo: 26/26 (`reports/demo_populated_e2e.json`)
- Canonical 11, integration 13, meeting 4, recovery 4, fixture-derived 1, chat policy 5, risk 7
- Retrieval eval (machine-authored): Hit@3 **7/8**, Recall@3 micro **11/29** on new index
- Live gen/meeting: still `blocked_missing_configuration`

## Commands

See `LOCAL_SETUP.md` — author, import/publish, demo, smoke, recovery.
