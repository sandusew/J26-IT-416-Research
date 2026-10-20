"""Acquire Arts domain candidates with honest provenance and license labelling.

- NIE syllabus PDFs: recorded as candidates with usage_permission=unclear (not indexed).
- Wikipedia extracts: CC BY-SA 4.0 — usage_permitted for local research indexing with attribution;
  review_status remains unreviewed (not teacher-reviewed).

Does not fabricate teacher approval. Does not mix into generated fixtures.
"""

from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from arts_ai.common.hashing import file_sha256
from arts_ai.common.manifests import save_json
from arts_ai.common.paths import get_paths

UA = "ArtsAI-ResearchBot/0.1 (local educational research; contact: local-dev)"

# Align to existing synthetic catalogue subject/topic IDs (not NL classifier labels)
WIKI_DOCS = [
    {
        "document_id": "wiki_en_sri_lanka_history",
        "title": "History of Sri Lanka (Wikipedia extract)",
        "wiki_title": "History_of_Sri_Lanka",
        "subject_id": "sub_history",
        "topic_id": "sub_history_t00",
        "grade_year": "A/L",
        "language": "en",
        "curriculum_relevance_note": "Aligned to A/L History subject scope (Sri Lanka history); topic slot sub_history_t00",
    },
    {
        "document_id": "wiki_en_geography_sri_lanka",
        "title": "Geography of Sri Lanka (Wikipedia extract)",
        "wiki_title": "Geography_of_Sri_Lanka",
        "subject_id": "sub_geography",
        "topic_id": "sub_geography_t00",
        "grade_year": "A/L",
        "language": "en",
        "curriculum_relevance_note": "Aligned to A/L Geography subject scope",
    },
    {
        "document_id": "wiki_en_economics",
        "title": "Economics (Wikipedia extract)",
        "wiki_title": "Economics",
        "subject_id": "sub_economics",
        "topic_id": "sub_economics_t00",
        "grade_year": "A/L",
        "language": "en",
        "curriculum_relevance_note": "Introductory economics concepts for A/L Economics subject scope",
    },
    {
        "document_id": "wiki_en_politics_sri_lanka",
        "title": "Politics of Sri Lanka (Wikipedia extract)",
        "wiki_title": "Politics_of_Sri_Lanka",
        "subject_id": "sub_political",
        "topic_id": "sub_political_t00",
        "grade_year": "A/L",
        "language": "en",
        "curriculum_relevance_note": "Aligned to A/L Political Science subject scope",
    },
]

NIE_CANDIDATES = [
    {
        "document_id": "nie_history_syllabus_e12syl11",
        "title": "NIE G.C.E. A/L History Syllabus (Grades 12–13)",
        "source_url": "https://nie.lk/pdffiles/tg/e12syl11.pdf",
        "subject_id": "sub_history",
        "topic_id": "unspecified",
        "language": "en",
        "publisher": "National Institute of Education, Sri Lanka",
        "usage_permission_or_license": "unclear_nie_public_pdf_all_rights_reserved_candidate_only",
        "permission_note": (
            "Publicly accessible on nie.lk; Channel NIE / Exams NIE terms restrict copying without "
            "permission. Recorded as candidate only — not promoted to domain index."
        ),
    },
    {
        "document_id": "nie_economics_syllabus_e12syl49",
        "title": "NIE G.C.E. A/L Economics Syllabus",
        "source_url": "https://nie.lk/pdffiles/tg/e12syl49.pdf",
        "subject_id": "sub_economics",
        "topic_id": "unspecified",
        "language": "en",
        "publisher": "National Institute of Education, Sri Lanka",
        "usage_permission_or_license": "unclear_nie_public_pdf_all_rights_reserved_candidate_only",
        "permission_note": "Same as History NIE candidate — awaiting written permission / fair-use clearance.",
    },
]


def _rel(path: Path) -> str:
    root = get_paths().ml_root.parent.parent  # Arts_AI/
    try:
        return str(path.resolve().relative_to(root.resolve())).replace("\\", "/")
    except ValueError:
        return str(path).replace("\\", "/")


def fetch_wikipedia_extract(title: str) -> dict:
    import urllib.parse

    url = (
        "https://en.wikipedia.org/w/api.php?"
        + urllib.parse.urlencode(
            {
                "action": "query",
                "prop": "extracts",
                "explaintext": "1",
                "redirects": "1",
                "titles": title.replace("_", " "),
                "format": "json",
            }
        )
    )
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    pages = data["query"]["pages"]
    page = next(iter(pages.values()))
    if "missing" in page or not page.get("extract"):
        raise RuntimeError(f"Wikipedia extract missing for {title}")
    text = page["extract"].strip()
    # Bound size for local research demo (keep substantial but tractable)
    if len(text) > 12000:
        text = text[:12000].rsplit("\n", 1)[0] + "\n\n[Extract truncated for local indexing.]"
    return {
        "pageid": page.get("pageid"),
        "title": page.get("title"),
        "text": text,
        "canonical_url": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
    }


def acquire_wikipedia(pending: Path) -> list[dict]:
    pending.mkdir(parents=True, exist_ok=True)
    acquired = []
    now = datetime.now(timezone.utc).isoformat()
    for spec in WIKI_DOCS:
        page = fetch_wikipedia_extract(spec["wiki_title"])
        out = pending / f"{spec['document_id']}.txt"
        out.write_text(page["text"], encoding="utf-8")
        meta = {
            "document_id": spec["document_id"],
            "title": spec["title"],
            "source_url": page["canonical_url"],
            "publisher_author": "Wikipedia contributors",
            "publication_version": f"pageid={page['pageid']}; acquired snapshot",
            "subject_id": spec["subject_id"],
            "topic_id": spec["topic_id"],
            "grade_year": spec["grade_year"],
            "language": spec["language"],
            "acquisition_timestamp_utc": now,
            "file_hash": file_sha256(out),
            "usage_permission_or_license": "CC-BY-SA-4.0",
            "usage_permitted": True,
            "license_attribution_required": True,
            "content_review_status": "unreviewed",
            "review_status": "unreviewed",
            "teacher_reviewed": False,
            "curriculum_relevance_checked": True,
            "curriculum_relevance_note": spec["curriculum_relevance_note"],
            "extraction_method": "wikipedia_mediawiki_api_plaintext_extract",
            "extraction_quality_status": "ok" if len(page["text"]) >= 200 else "thin",
            "data_origin": "authentic_public_cc_by_sa",
            "acquired": True,
            "sinhala_support_claimed": False,
        }
        (pending / f"{spec['document_id']}.txt.meta.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )
        acquired.append(meta)
    return acquired


def record_nie_candidates(candidates_dir: Path) -> list[dict]:
    """Download NIE PDFs into candidates/ only — do not promote to index."""
    candidates_dir.mkdir(parents=True, exist_ok=True)
    out = []
    now = datetime.now(timezone.utc).isoformat()
    for spec in NIE_CANDIDATES:
        dest = candidates_dir / f"{spec['document_id']}.pdf"
        status = "acquired_file"
        err = None
        try:
            req = urllib.request.Request(spec["source_url"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as resp:
                dest.write_bytes(resp.read())
        except Exception as e:  # noqa: BLE001
            status = "download_failed"
            err = str(e)
        meta = {
            **spec,
            "acquisition_timestamp_utc": now,
            "acquired": status == "acquired_file",
            "acquisition_status": status,
            "download_error": err,
            "usage_permitted": False,
            "content_review_status": "unreviewed",
            "review_status": "unreviewed",
            "teacher_reviewed": False,
            "curriculum_relevance_checked": True,
            "extraction_method": "pending_pdf_text_extract",
            "extraction_quality_status": "not_extracted_candidate_hold",
            "ocr_required": None,
            "data_origin": "official_public_page_candidate",
            "file_hash": file_sha256(dest) if dest.exists() else None,
            "local_path": _rel(dest) if dest.exists() else None,
            "promotion_blocked_reason": "usage_permission_unclear",
        }
        (candidates_dir / f"{spec['document_id']}.meta.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )
        out.append(meta)
    return out


def main() -> dict:
    paths = get_paths()
    root = paths.arts_content
    pending = root / "approved_pending"
    candidates = root / "candidates"
    pending.mkdir(parents=True, exist_ok=True)
    candidates.mkdir(parents=True, exist_ok=True)

    wiki = acquire_wikipedia(pending)
    nie = record_nie_candidates(candidates)
    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "wikipedia_cc_by_sa_acquired": len(wiki),
        "nie_candidates_recorded": len(nie),
        "wikipedia_docs": [
            {"document_id": d["document_id"], "subject_id": d["subject_id"], "file_hash": d["file_hash"]}
            for d in wiki
        ],
        "nie_candidates": [
            {
                "document_id": d["document_id"],
                "acquisition_status": d["acquisition_status"],
                "usage_permitted": d["usage_permitted"],
                "promotion_blocked_reason": d["promotion_blocked_reason"],
            }
            for d in nie
        ],
        "note": (
            "Wikipedia extracts may be promoted to domain index (CC BY-SA, unreviewed). "
            "NIE PDFs remain candidates until reuse permission is clarified."
        ),
    }
    save_json(report, paths.reports / "c4_domain_acquisition.json")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    main()
