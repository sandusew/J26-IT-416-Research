# Missing / pending Arts domain content

## Currently available for domain index

| Document | License | Review | Status |
|----------|---------|--------|--------|
| Wikipedia extracts (History, Geography, Economics, Politics of Sri Lanka / Economics) | CC BY-SA 4.0 | **unreviewed** | Indexed in domain corpus |
| NIE History / Economics syllabus PDFs | Public page; reuse **unclear** | unreviewed | Held in `candidates/` — not indexed |

## Still needed for fuller A/L Arts coverage

1. **Teacher-reviewed** passages mapped to each catalogue topic (`sub_*_t00`…`t07`) with completed `TEACHER_REVIEW_TEMPLATE.md` evidence.
2. **Sinhala Literature** (`sub_sinhala_lit`) sources with clear reuse permission; Sinhala query support is **not claimed** (file parsing ≠ query QA).
3. Written permission or clear open license for **NIE** syllabus/teacher-guide text before promotion from `candidates/`.
4. Optional: short OCR-ready scans only when text extraction fails (`ocr_required=true`).

## Commands

```powershell
cd <repo>\backend\ml
.\.venv\Scripts\python.exe scripts\acquire_domain_candidates.py
.\.venv\Scripts\python.exe -m arts_ai.c4_chatbot.knowledge_ingest
.\.venv\Scripts\python.exe scripts\eval_domain_retrieval.py
```
