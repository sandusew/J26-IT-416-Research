# Content review package — provisional technical slice

**Slice selection (not final subject approval):** `hist_sl_rajarata_politics`  
**Curriculum version:** `nie_al_arts_provisional_v0.1`  
**Why selected:** Has supplemental CC BY-SA teaching extracts already indexed (`wiki_en_anuradhapura`, `wiki_en_polonnaruwa`) and a clear NIE structure reference (§3.1 competency 5.0). Used only to exercise the canonical import → quiz → Twin → recommendation → domain chat path under provisional scope.

## Curriculum reference

| Field | Value |
|-------|--------|
| subject_id | sub_history |
| topic_id | hist_sl_rajarata_politics |
| grade | 12 |
| medium | english |
| source_reference | https://nie.lk/pdffiles/tg/e12syl11.pdf |
| source_page_or_section | §3.1 competency 5.0 |
| learning_outcome_basis | draft_inferred (paraphrase — not verbatim official LO extract) |

## Permitted teaching materials (supplemental)

| document_id | license | review_status |
|-------------|---------|---------------|
| wiki_en_anuradhapura | CC-BY-SA-4.0 | unreviewed |
| wiki_en_polonnaruwa | CC-BY-SA-4.0 | unreviewed |

Wikipedia remains supplemental — not a complete A/L teaching corpus.

## Candidate questions

See `fixture_import_batch.json` — **labelled test fixtures** (`isTestFixture=true`).  
Provenance: `machine_authored_test_fixture_not_past_paper`.  
These must not increase real teacher-review or authentic coverage counts.

## Missing items

- Verbatim official learning outcomes with page extract evidence
- Teacher-authored or exam-board questions with permission
- Sinhala medium materials for this topic
- `wiki_en_climate_sri_lanka` acquired to `approved_pending` after 429 retry (geo_climate; outside this hist slice — not promoted to serving index)

## Reviewer checklist (unfilled)

- [ ] Curriculum relevance confirmed for each question
- [ ] Answer key verified
- [ ] Language/grade appropriate
- [ ] Source/permission acceptable for learner use
- [ ] Approve with `reviewEvidence` naming the real reviewer
- [ ] Do **not** approve `partial_match` synthetic items as verified canonical

## Server fixture policy (required for demo)

Client `allowTestFixtures=true` alone is **ignored**. For isolated fixture demos:

```powershell
# In backend\api\.env (never production):
# ARTS_AI_ALLOW_TEST_FIXTURES=true
# NODE_ENV=development
```

Production (`NODE_ENV=production`) always rejects fixture-enabled execution.

## Import commands (from repo root)

```powershell
cd backend\api
# Start API + Mongo as usual, then:
$tea = Invoke-RestMethod -Method POST http://127.0.0.1:4000/auth/login -ContentType 'application/json' -Body '{"username":"tea","password":"pw"}'
$hdr = @{ Authorization = "Bearer $($tea.token)" }
$batch = Get-Content ..\ml\data\curriculum\review_packages\hist_sl_rajarata_politics_v0\fixture_import_batch.json -Raw | ConvertFrom-Json
# Dry-run
Invoke-RestMethod -Method POST http://127.0.0.1:4000/catalogue/import -Headers $hdr -ContentType 'application/json' -Body ($batch | ConvertTo-Json -Depth 8)
# Persist valid rows (drop partial_match)
$batch.dryRun = $false
$batch.questions = @($batch.questions | Where-Object { $_.mappingStatus -ne 'partial_match' })
Invoke-RestMethod -Method POST 'http://127.0.0.1:4000/catalogue/import?dryRun=false' -Headers $hdr -ContentType 'application/json' -Body ($batch | ConvertTo-Json -Depth 8)
# Review each question with real evidence text (fixture demos must label TEST_FIXTURE…)
# Assign: allowTestFixtures=true only when ARTS_AI_ALLOW_TEST_FIXTURES=true
```

Expected dry-run: valid rows accepted; `partial_match` and `approved_for_learner` import attempts rejected.

## Still needed for authentic workflow

| Field | Status |
|-------|--------|
| Official LO verbatim + page | Missing |
| Teacher-authored / permitted questions | Missing |
| Authentic reviewer identity + evidence | Missing |
| Permission for learner-facing use | Missing |
| Authentic approved count | **0** |
