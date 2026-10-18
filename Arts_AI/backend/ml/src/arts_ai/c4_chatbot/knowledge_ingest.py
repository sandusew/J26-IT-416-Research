"""Arts knowledge corpus ingestion — domain vs generated fixtures kept separate.

Promotion gates (all required for domain index eligibility):
- acquired
- usage_permitted
- extraction_quality ok
- curriculum_relevance_checked

teacher_reviewed is optional and never auto-asserted.
approved_pending/ is intake, not approval evidence.
candidates/ holds acquired materials with unclear reuse terms.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import pandas as pd

from arts_ai.common.hashing import file_sha256
from arts_ai.common.logging_utils import get_logger
from arts_ai.common.manifests import save_json
from arts_ai.common.paths import get_paths
from arts_ai.c4_chatbot.rag import KnowledgeIndex

logger = get_logger("arts_ai.c4.knowledge_ingest")

REGISTRY_NAME = "corpus_registry.json"
PERMITTED_LICENSES = {
    "CC-BY-SA-4.0",
    "CC-BY-4.0",
    "CC0-1.0",
    "public_domain",
    "project_owned_research_text",
}


def repo_relative(path: Path | str) -> str:
    p = Path(path).resolve()
    root = get_paths().ml_root.parent.parent  # Arts_AI/
    try:
        return str(p.relative_to(root)).replace("\\", "/")
    except ValueError:
        try:
            return str(p.relative_to(get_paths().ml_root)).replace("\\", "/")
        except ValueError:
            return str(p).replace("\\", "/")


INTAKE_CHECKLIST = """# Arts knowledge content intake checklist

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
cd <repo>\\backend\\ml
.\\.venv\\Scripts\\python.exe scripts\\acquire_domain_candidates.py
.\\.venv\\Scripts\\python.exe -m arts_ai.c4_chatbot.knowledge_ingest
```

Domain retrieval stays **awaiting_content** until at least one document passes all promotion gates.
Do not mark downloads as teacher-reviewed without completed review evidence.
"""


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def ensure_layout() -> dict[str, Path]:
    root = get_paths().arts_content
    paths = {
        "root": root,
        "candidates": root / "candidates",
        "approved": root / "approved",
        "approved_pending": root / "approved_pending",
        "generated": root / "generated_awaiting_review",
        "indexes": root / "indexes",
        "eval": root / "eval",
    }
    for p in paths.values():
        p.mkdir(parents=True, exist_ok=True)
    checklist = root / "CONTENT_INTAKE_CHECKLIST.md"
    checklist.write_text(INTAKE_CHECKLIST, encoding="utf-8")
    return paths


def extract_text_from_file(path: Path) -> dict[str, Any]:
    """Parse supported files; flag OCR / empty / corrupted honestly."""
    suf = path.suffix.lower()
    if suf in {".txt", ".md"}:
        raw = path.read_bytes()
        try:
            text = raw.decode("utf-8")
            method = "utf8_text"
        except UnicodeDecodeError:
            text = raw.decode("utf-8", errors="replace")
            method = "utf8_replace"
        n_repl = text.count("\ufffd")
        n_si = sum(1 for ch in text if "\u0d80" <= ch <= "\u0dff")
        empty = len(text.strip()) == 0
        quality = "ok"
        ocr_required = False
        if empty:
            quality = "empty"
        elif n_repl > max(20, len(text) // 50):
            quality = "corrupted_or_binary"
            ocr_required = True
        elif len(text.strip()) < 40:
            quality = "too_short"
        return {
            "text": text,
            "extraction_method": method,
            "extraction_quality_status": quality,
            "ocr_required": ocr_required,
            "n_chars": len(text),
            "n_sinhala_chars": n_si,
            "ok": quality == "ok",
        }

    if suf == ".pdf":
        try:
            from pypdf import PdfReader  # type: ignore

            reader = PdfReader(str(path))
            pages = []
            for i, page in enumerate(reader.pages):
                t = page.extract_text() or ""
                if t.strip():
                    pages.append(f"[page={i + 1}]\n{t}")
            text = "\n\n".join(pages)
            empty = len(text.strip()) < 40
            ocr = empty  # likely image-only PDF
            return {
                "text": text,
                "extraction_method": "pypdf_text",
                "extraction_quality_status": "ocr_required" if ocr else "ok",
                "ocr_required": ocr,
                "n_chars": len(text),
                "n_sinhala_chars": sum(1 for ch in text if "\u0d80" <= ch <= "\u0dff"),
                "n_pages": len(reader.pages),
                "ok": not ocr,
            }
        except ImportError:
            return {
                "text": "",
                "extraction_method": "pdf_parser_unavailable",
                "extraction_quality_status": "parser_missing_install_pypdf",
                "ocr_required": True,
                "n_chars": 0,
                "n_sinhala_chars": 0,
                "ok": False,
            }
        except Exception as e:  # noqa: BLE001
            return {
                "text": "",
                "extraction_method": "pdf_extract_failed",
                "extraction_quality_status": f"error:{e}",
                "ocr_required": True,
                "n_chars": 0,
                "n_sinhala_chars": 0,
                "ok": False,
            }

    return {
        "text": "",
        "extraction_method": f"unsupported_suffix:{suf}",
        "extraction_quality_status": "unsupported",
        "ocr_required": False,
        "n_chars": 0,
        "n_sinhala_chars": 0,
        "ok": False,
    }


def scan_pending(pending: Path) -> list[dict[str, Any]]:
    docs = []
    for f in sorted(pending.iterdir()):
        if not f.is_file():
            continue
        if f.suffix.lower() not in {".txt", ".md", ".pdf"}:
            continue
        if f.name.endswith(".meta.json"):
            continue
        extracted = extract_text_from_file(f)
        meta_path = Path(str(f) + ".meta.json") if f.suffix.lower() == ".pdf" else f.with_suffix(f.suffix + ".meta.json")
        # also try stem.meta.json
        alt = f.with_name(f.name + ".meta.json")
        if not meta_path.exists() and alt.exists():
            meta_path = alt
        if not meta_path.exists():
            # convention: file.txt.meta.json
            meta_path = Path(str(f) + ".meta.json")
        meta: dict[str, Any] = {}
        if meta_path.exists():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        usage = meta.get("usage_permission_or_license") or "unknown_verify_before_use"
        usage_permitted = bool(meta.get("usage_permitted"))
        if usage in PERMITTED_LICENSES:
            usage_permitted = True
        review = meta.get("review_status") or meta.get("content_review_status") or "unreviewed"
        if review == "teacher_reviewed" and not meta.get("review_evidence"):
            review = "unreviewed"  # never invent teacher approval
        docs.append(
            {
                "document_id": meta.get("document_id") or f"doc_{f.stem}",
                "title": meta.get("title") or f.stem,
                "source_url": meta.get("source_url"),
                "supplied_file_origin": repo_relative(f),
                "publisher_author": meta.get("publisher_author"),
                "publication_version": meta.get("publication_version")
                or meta.get("version_or_publication_date"),
                "subject_id": meta.get("subject_id") or "unspecified",
                "topic_id": meta.get("topic_id") or "unspecified",
                "grade_year": meta.get("grade_year") or "A/L",
                "language": meta.get("language")
                or ("si" if extracted["n_sinhala_chars"] > 20 else "en"),
                "acquisition_timestamp_utc": meta.get("acquisition_timestamp_utc")
                or datetime.now(timezone.utc).isoformat(),
                "file_hash": file_sha256(f),
                "text_hash": _sha256_text(extracted["text"]) if extracted["text"] else None,
                "usage_permission_or_license": usage,
                "usage_permitted": usage_permitted,
                "curriculum_relevance_checked": bool(meta.get("curriculum_relevance_checked")),
                "curriculum_relevance_note": meta.get("curriculum_relevance_note"),
                "curriculum_version": meta.get("curriculum_version"),
                "curriculum_mapping_basis": meta.get("curriculum_mapping_basis"),
                "learning_outcomes_supported": meta.get("learning_outcomes_supported") or [],
                "role": meta.get("role"),
                "review_status": review,
                "content_review_status": review,
                "review_evidence": meta.get("review_evidence"),
                "teacher_reviewed": review == "teacher_reviewed" and bool(meta.get("review_evidence")),
                "extraction_method": extracted["extraction_method"],
                "extraction_quality_status": extracted["extraction_quality_status"],
                "ocr_required": extracted.get("ocr_required"),
                "extraction_quality": {
                    "n_chars": extracted["n_chars"],
                    "n_sinhala_chars": extracted["n_sinhala_chars"],
                    "ok": extracted["ok"],
                    "status": extracted["extraction_quality_status"],
                },
                "data_origin": meta.get("data_origin") or "arts_domain_candidate",
                "acquired": True,
                "sinhala_support_claimed": False,
                "text": extracted["text"],
            }
        )
    return docs


def promotion_eligible(doc: dict[str, Any]) -> tuple[bool, str | None]:
    if not doc.get("usage_permitted"):
        return False, "usage_not_permitted"
    if not (doc.get("extraction_quality") or {}).get("ok"):
        return False, f"extraction_{doc.get('extraction_quality_status')}"
    if not doc.get("curriculum_relevance_checked"):
        return False, "curriculum_relevance_not_checked"
    if not (doc.get("text") or "").strip():
        return False, "empty_text"
    return True, None


def build_approved_index(*, require_teacher_reviewed: bool = False) -> dict[str, Any]:
    paths = ensure_layout()
    reg_path = paths["root"] / REGISTRY_NAME
    pending_docs = scan_pending(paths["approved_pending"])

    promoted = []
    blocked = []
    seen_hashes: dict[str, str] = {}
    for d in pending_docs:
        ok, reason = promotion_eligible(d)
        th = d.get("text_hash")
        if th and th in seen_hashes:
            ok = False
            reason = f"duplicate_of:{seen_hashes[th]}"
        if not ok:
            blocked.append({"document_id": d["document_id"], "reason": reason})
            continue
        seen_hashes[th] = d["document_id"]
        out = paths["approved"] / f"{d['document_id']}.txt"
        out.write_text(d["text"], encoding="utf-8")
        meta = {k: v for k, v in d.items() if k != "text"}
        meta["supplied_file_origin"] = repo_relative(out)
        meta["file_hash"] = file_sha256(out)
        (paths["approved"] / f"{d['document_id']}.meta.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )
        promoted.append(d)

    # Load all approved metas (including previously promoted)
    documents = []
    for meta_f in sorted(paths["approved"].glob("*.meta.json")):
        meta = json.loads(meta_f.read_text(encoding="utf-8"))
        txt = paths["approved"] / f"{meta['document_id']}.txt"
        if txt.exists():
            meta["text"] = txt.read_text(encoding="utf-8")
            documents.append(meta)

    # Include AI-authored practice teaching packages (labelled; not fixtures; not teacher-reviewed)
    practice_root = paths["root"] / "practice" / "packages"
    if practice_root.exists():
        for pkg_dir in sorted(practice_root.iterdir()):
            if not pkg_dir.is_dir():
                continue
            body_p = pkg_dir / "teaching_package.body.txt"
            man_p = pkg_dir / "package_manifest.json"
            if not body_p.exists() or not man_p.exists():
                continue
            man = json.loads(man_p.read_text(encoding="utf-8"))
            text = body_p.read_text(encoding="utf-8")
            if len(text.strip()) < 200:
                continue
            documents.append(
                {
                    "document_id": f"prac_pkg_{man.get('topic_id')}",
                    "title": f"{man.get('topic_title')} (AI-authored practice package)",
                    "subject_id": man.get("subject_id"),
                    "topic_id": man.get("topic_id"),
                    "language": man.get("language") or "en",
                    "curriculum_version": "nie_al_arts_provisional_v0.1",
                    "source_url": (man.get("sources_meta") or [{}])[0].get("url"),
                    "usage_permission_or_license": "AI-authored; underlying extracts CC-BY-SA-4.0",
                    "usage_permitted": True,
                    "curriculum_relevance_checked": True,
                    "review_status": "unreviewed",
                    "content_review_status": "unreviewed",
                    "teacher_reviewed": False,
                    "data_origin": "ai_authored_source_grounded",
                    "content_origin": "ai_authored_source_grounded",
                    "human_review_status": "unreviewed",
                    "role": "ai_authored_practice_teaching_package",
                    "extraction_quality": {"ok": True, "status": "ok", "n_chars": len(text)},
                    "extraction_quality_status": "ok",
                    "text_hash": _sha256_text(text),
                    "text": text,
                }
            )

    registry = {
        "updated_at_utc": datetime.now(timezone.utc).isoformat(),
        "n_documents": len(documents),
        "documents": [{k: v for k, v in d.items() if k != "text"} for d in documents],
        "promotion_blocked": blocked,
        "note": "review_status=teacher_reviewed only when review_evidence is present",
    }
    save_json(registry, reg_path)

    eligible = documents
    if require_teacher_reviewed:
        eligible = [
            d
            for d in documents
            if d.get("review_status") == "teacher_reviewed" and d.get("review_evidence")
        ]
    else:
        # Re-check gates on approved copies
        eligible = []
        for d in documents:
            ok, _ = promotion_eligible(d)
            if ok:
                eligible.append(d)

    status: dict[str, Any] = {
        "run_id": f"c4_index_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{uuid4().hex[:8]}",
        "registry_path": repo_relative(reg_path),
        "n_registered": len(documents),
        "n_indexable": len(eligible),
        "n_blocked_pending": len(blocked),
        "domain_retrieval_status": "ready" if eligible else "awaiting_content",
        "generated_fixtures_separated": True,
        "generated_path": repo_relative(paths["generated"]),
        "indexing_note": "Index construction is implementation/indexing, not language-model training",
        "sinhala_query_support": "not_claimed",
        "topic_classifier_scope": (
            "closed_set_generated_nl — does not gate domain retrieval; "
            "topics outside NL taxonomy remain retrievable"
        ),
    }

    if not eligible:
        status["intake_checklist"] = repo_relative(paths["root"] / "CONTENT_INTAKE_CHECKLIST.md")
        status["note"] = (
            "No domain-eligible documents for indexing. "
            "Ingestion workflow is implemented; domain RAG remains awaiting_content."
        )
        save_json(status, get_paths().reports / "c4_knowledge_ingest_status.json")
        save_json(status, paths["indexes"] / "LATEST_DOMAIN_INDEX_STATUS.json")
        return status

    rows = [
        {
            "document_id": d["document_id"],
            "subject_id": d.get("subject_id"),
            "topic_id": d.get("topic_id"),
            "language": d.get("language") or "en",
            "curriculum_version": d.get("curriculum_version"),
            "source_reference": d.get("source_url") or d.get("supplied_file_origin"),
            "permission_reference": d.get("usage_permission_or_license"),
            "review_status": d.get("review_status"),
            "human_review_status": d.get("human_review_status") or d.get("review_status"),
            "content_origin": d.get("content_origin") or d.get("data_origin"),
            "data_origin": d.get("data_origin") or "arts_domain",
            "section_ref": None,
            "text": d["text"],
        }
        for d in eligible
    ]
    # Preserve page markers in chunk source refs via chunk_text already keeping [page=]
    idx = KnowledgeIndex()
    n = idx.ingest_documents(pd.DataFrame(rows))
    # Annotate corpus provenance on index config
    idx.config = {
        **(idx.config or {}),
        "corpus_mode": "domain",
        "corpus_version": status["run_id"],
        "data_origin": "domain_cc_or_permitted",
        "n_documents": len(eligible),
    }
    idx_dir = paths["indexes"] / status["run_id"]
    idx_dir.mkdir(parents=True, exist_ok=True)
    out_path = idx_dir / "domain_knowledge_index.joblib"
    saved = idx.save(out_path, update_latest_pointer=False)
    # Do NOT overwrite fixture LATEST_INDEX — domain has its own pointer
    (paths["indexes"] / "LATEST_DOMAIN_INDEX.txt").write_text(status["run_id"], encoding="utf-8")
    status["n_chunks"] = n
    status["index_path"] = repo_relative(saved)
    status["index_sha256"] = file_sha256(saved)
    status["document_ids"] = [d["document_id"] for d in eligible]
    save_json(status, get_paths().reports / "c4_knowledge_ingest_status.json")
    save_json(status, idx_dir / "status.json")
    save_json(status, paths["indexes"] / "LATEST_DOMAIN_INDEX_STATUS.json")
    logger.info("Domain index %s chunks=%s", status["run_id"], n)
    return status


def load_domain_index() -> KnowledgeIndex | None:
    paths = ensure_layout()
    ptr = paths["indexes"] / "LATEST_DOMAIN_INDEX.txt"
    if not ptr.exists():
        return None
    run_id = ptr.read_text(encoding="utf-8").strip()
    path = paths["indexes"] / run_id / "domain_knowledge_index.joblib"
    if not path.exists():
        return None
    return KnowledgeIndex.load(path)


if __name__ == "__main__":
    print(json.dumps(build_approved_index(), indent=2, default=str))
