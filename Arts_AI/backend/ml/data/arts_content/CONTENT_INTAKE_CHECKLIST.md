# Arts knowledge content intake checklist

## Folders

| Path | Meaning |
|------|---------|
| `candidates/` | Acquired materials with **unclear** reuse permission — do not index as domain |
| `approved_pending/` | Intake for usage-permitted texts awaiting promotion checks |
| `approved/` | Promoted copies eligible for domain indexing (may still be unreviewed by teachers) |
| `generated_awaiting_review/` | Synthetic/generated fixtures — **never** mix into domain index |

## Per-document metadata (sidecar `*.txt.meta.json`)

- document_id, title, subject_id, topic_id, grade_year, language
- source_url OR supplied_file_origin, publisher_author, publication_version
- acquisition_timestamp_utc, file_hash
- usage_permission_or_license, usage_permitted (true/false)
- curriculum_relevance_checked (true/false) + note
- content_review_status / review_status: unreviewed | teacher_reviewed
- review_evidence (required for teacher_reviewed)
- extraction_method, extraction_quality_status, ocr_required

## Promote / index

```powershell
cd <repo>\backend\ml
.\.venv\Scripts\python.exe scripts\acquire_domain_candidates.py
.\.venv\Scripts\python.exe -m arts_ai.c4_chatbot.knowledge_ingest
```

Domain retrieval stays **awaiting_content** until at least one document passes all promotion gates.
Do not mark downloads as teacher-reviewed without completed review evidence.
