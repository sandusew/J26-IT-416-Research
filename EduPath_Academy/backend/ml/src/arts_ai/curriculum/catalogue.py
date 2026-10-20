"""Curriculum-aligned resource and question catalogue validation."""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from arts_ai.common.manifests import save_json
from arts_ai.common.paths import get_paths
from arts_ai.curriculum.registry import CURRICULUM_VERSION, load_registry

RESOURCE_REQUIRED = [
    "resource_id",
    "curriculum_version",
    "subject_id",
    "topic_ids",
    "language",
    "resource_type",
    "difficulty",
    "difficulty_basis",
    "prerequisite_topic_ids",
    "source_document_id_or_url",
    "availability",
    "permission_status",
    "review_status",
    "version",
]

QUESTION_REQUIRED = [
    "question_id",
    "curriculum_version",
    "subject_id",
    "topic_id",
    "language",
    "question_type",
    "prompt",
    "correct_answer_or_rubric",
    "max_marks",
    "difficulty",
    "difficulty_basis",
    "source_reference",
    "provenance",
    "review_status",
    "version",
]

SUPPORTED_QUESTION_TYPES = {
    "mcq",
    "short_answer",
    "structured",
    "essay_rubric",  # scoring is rubric-assisted, not claimed as validated essay marking
    "true_false",
}

SUPPORTED_LANGUAGES = {"en", "english", "si", "sinhala", "ta", "tamil"}


@dataclass
class ValidationReport:
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    n_rows: int = 0


def _canon_ids() -> set[str]:
    return {t["topic_id"] for t in load_registry().get("topics", [])}


def _legacy_map() -> dict[str, str | None]:
    m = {}
    for row in load_registry().get("legacy_topic_mappings", []):
        m[row["legacy_topic_id"]] = row.get("canonical_topic_id")
    return m


def validate_resource_row(row: dict[str, Any], *, seen: set[str]) -> list[str]:
    errs = []
    # Empty list / empty string is valid for prerequisite_topic_ids (means none)
    optional_empty_ok = {"prerequisite_topic_ids", "learning_outcome_ids"}
    for k in RESOURCE_REQUIRED:
        if k in optional_empty_ok:
            if row.get(k) is None:
                errs.append(f"missing_field:{k}")
            continue
        if row.get(k) in (None, ""):
            errs.append(f"missing_field:{k}")
    rid = row.get("resource_id")
    if rid in seen:
        errs.append(f"duplicate_resource_id:{rid}")
    if rid:
        seen.add(rid)
    if row.get("curriculum_version") not in (None, "", CURRICULUM_VERSION):
        # Allow legacy synthetic version explicitly labelled
        if row.get("curriculum_version") not in {"provisional_v0.1", CURRICULUM_VERSION}:
            errs.append(f"invalid_curriculum_version:{row.get('curriculum_version')}")
    lang = str(row.get("language") or "").lower()
    if lang and lang not in SUPPORTED_LANGUAGES:
        errs.append(f"unsupported_language:{lang}")
    topics = row.get("topic_ids")
    if isinstance(topics, str):
        topics = [t.strip() for t in topics.split("|") if t.strip()]
    canon = _canon_ids()
    legacy = _legacy_map()
    soft: list[str] = []
    for tid in topics or []:
        if tid not in canon and tid not in legacy:
            errs.append(f"unknown_topic_id:{tid}")
        elif tid in legacy and legacy[tid] is None:
            # Deferred subjects (e.g. Sinhala Lit) — gap, not schema crash
            soft.append(f"unmapped_legacy_topic:{tid}")
    if str(row.get("review_status")) == "teacher_reviewed" and not row.get("review_evidence"):
        errs.append("teacher_reviewed_without_evidence")
    row["_soft_warnings"] = soft
    return errs


def validate_question_row(row: dict[str, Any], *, seen: set[str]) -> list[str]:
    errs = []
    for k in QUESTION_REQUIRED:
        if row.get(k) in (None, ""):
            errs.append(f"missing_field:{k}")
    qid = row.get("question_id")
    if qid in seen:
        errs.append(f"duplicate_question_id:{qid}")
    if qid:
        seen.add(qid)
    qtype = str(row.get("question_type") or "").lower()
    if qtype and qtype not in SUPPORTED_QUESTION_TYPES:
        errs.append(f"unsupported_question_type:{qtype}")
    if qtype == "mcq":
        opts = row.get("options")
        if not opts:
            errs.append("mcq_missing_options")
        ans = row.get("correct_answer_or_rubric") or row.get("answer_or_rubric")
        if not ans:
            errs.append("mcq_missing_answer_key")
    lang = str(row.get("language") or "").lower()
    if lang and lang not in SUPPORTED_LANGUAGES:
        errs.append(f"unsupported_language:{lang}")
    tid = row.get("topic_id")
    canon = _canon_ids()
    legacy = _legacy_map()
    if tid and tid not in canon and tid not in legacy:
        errs.append(f"unknown_topic_id:{tid}")
    if tid in legacy and legacy.get(tid) is None:
        errs.append(f"unmapped_legacy_topic:{tid}")
    if not row.get("provenance") and not row.get("source_reference"):
        errs.append("missing_provenance")
    if str(row.get("review_status")) == "teacher_reviewed" and not row.get("review_evidence"):
        errs.append("teacher_reviewed_without_evidence")
    # Never claim generated as reviewed
    if str(row.get("provenance") or "").startswith("generated") and row.get("review_status") == "teacher_reviewed":
        errs.append("generated_marked_teacher_reviewed")
    return errs


def validate_synthetic_catalogue() -> dict[str, Any]:
    """Audit existing synthetic CSV against new contracts (report gaps; do not invent past papers)."""
    syn = get_paths().synthetic
    dirs = sorted([p for p in syn.iterdir() if p.is_dir() and (p / "questions.csv").exists()])
    preferred = next((d for d in dirs if d.name.startswith("arts_al_baseline")), dirs[-1] if dirs else None)
    report: dict[str, Any] = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "curriculum_version_target": CURRICULUM_VERSION,
        "catalogue_dir": str(preferred) if preferred else None,
        "resources": ValidationReport(ok=True).__dict__,
        "questions": ValidationReport(ok=True).__dict__,
        "note": (
            "Synthetic catalogue uses provisional IDs and generated provenance. "
            "Gaps are expected until curriculum-aligned import. "
            "Do not silently invent authentic past-paper questions."
        ),
    }
    if not preferred:
        report["error"] = "no_synthetic_catalogue"
        save_json(report, get_paths().reports / "catalogue_validation.json")
        return report

    # Resources
    res_errs = []
    res_warns = []
    seen_r: set[str] = set()
    with (preferred / "resources.csv").open(encoding="utf-8") as f:
        resources = list(csv.DictReader(f))
    for r in resources:
        # Map synthetic columns into contract shape for checking
        row = {
            "resource_id": r.get("resource_id"),
            "curriculum_version": r.get("syllabus_version") or "provisional_v0.1",
            "subject_id": None,  # filled via topic
            "topic_ids": r.get("topic_id"),
            "language": r.get("language") or "english",
            "resource_type": r.get("type") or "note",
            "difficulty": r.get("difficulty"),
            "difficulty_basis": "synthetic_generator_heuristic",
            "prerequisite_topic_ids": r.get("prerequisite_topic_ids") if r.get("prerequisite_topic_ids") is not None else [],
            "source_document_id_or_url": r.get("source_reference") or "generated_provisional",
            "availability": "synthetic_fixture",
            "permission_status": r.get("permission_reference") or "synthetic_demo_fixture",
            "review_status": r.get("review_status") or "unreviewed",
            "version": r.get("generator_version") or "0.1.0",
            "review_evidence": None,
        }
        # Look up subject from registry legacy map
        legacy = _legacy_map()
        tid = r.get("topic_id")
        # subject from prefix
        if tid and tid.startswith("sub_"):
            row["subject_id"] = "_".join(tid.split("_")[:2]) if tid.count("_") >= 1 else tid
            # sub_history_t00 -> sub_history
            parts = tid.split("_")
            if len(parts) >= 2:
                row["subject_id"] = f"{parts[0]}_{parts[1]}"
        errs = validate_resource_row(row, seen=seen_r)
        soft = list(row.pop("_soft_warnings", []) or [])
        soft.extend([e for e in errs if e.startswith("missing_field:subject_id")])
        hard = [e for e in errs if e not in soft and not e.startswith("unmapped_legacy")]
        res_errs.extend(hard)
        res_warns.extend(soft)
        res_warns.append(f"synthetic_resource_not_curriculum_aligned:{r.get('resource_id')}")

    # Questions
    q_errs = []
    q_warns = []
    seen_q: set[str] = set()
    with (preferred / "questions.csv").open(encoding="utf-8") as f:
        questions = list(csv.DictReader(f))
    for q in questions:
        row = {
            "question_id": q.get("question_id"),
            "curriculum_version": "provisional_v0.1",
            "subject_id": None,
            "topic_id": q.get("topic_id"),
            "language": "english",
            "question_type": q.get("type") or "mcq",
            "prompt": q.get("text") or q.get("prompt"),
            "options": q.get("options"),
            "correct_answer_or_rubric": q.get("answer_or_rubric"),
            "max_marks": q.get("max_marks"),
            "difficulty": q.get("difficulty"),
            "difficulty_basis": "synthetic_generator_heuristic",
            "source_reference": q.get("source_reference") or "generated",
            "provenance": q.get("data_origin") or "generated_content",
            "review_status": q.get("review_status") or "unreviewed",
            "version": q.get("generator_version") or "0.1.0",
        }
        tid = q.get("topic_id") or ""
        parts = tid.split("_")
        if len(parts) >= 2:
            row["subject_id"] = f"{parts[0]}_{parts[1]}"
        errs = validate_question_row(row, seen=seen_q)
        soft_q = [e for e in errs if e.startswith("unmapped_legacy") or e.startswith("missing_field:subject_id")]
        q_errs.extend([e for e in errs if e not in soft_q])
        q_warns.extend(soft_q)
        q_warns.append(f"synthetic_question_draft:{q.get('question_id')}")

    report["resources"] = {
        "ok": len(res_errs) == 0,
        "n_rows": len(resources),
        "n_errors": len(res_errs),
        "n_warnings": len(res_warns),
        "error_sample": res_errs[:20],
        "warning_sample": res_warns[:10],
    }
    report["questions"] = {
        "ok": len(q_errs) == 0,
        "n_rows": len(questions),
        "n_errors": len(q_errs),
        "n_warnings": len(q_warns),
        "error_sample": q_errs[:20],
        "warning_sample": q_warns[:10],
        "essay_note": "essay_rubric type supported as rubric container only — not validated automated essay scoring",
    }
    report["gap"] = {
        "curriculum_aligned_reviewed_questions": 0,
        "curriculum_aligned_reviewed_resources": 0,
        "action": "Import teacher-authored or permitted items with canonical topic_ids; keep generated drafts labelled",
    }
    save_json(report, get_paths().reports / "catalogue_validation.json")
    # Write empty import templates
    tmpl = get_paths().data / "curriculum" / "import_templates"
    tmpl.mkdir(parents=True, exist_ok=True)
    (tmpl / "resources_template.csv").write_text(",".join(RESOURCE_REQUIRED) + "\n", encoding="utf-8")
    (tmpl / "questions_template.csv").write_text(
        ",".join(QUESTION_REQUIRED + ["options", "learning_outcome_id", "review_evidence"]) + "\n",
        encoding="utf-8",
    )
    return report


def import_curriculum_csv(
    *,
    resources_csv: Path | None = None,
    questions_csv: Path | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Validate curriculum-aligned import CSVs; optionally stage under data/curriculum/imports/.

    Preserves legacy IDs in a migration column when present. Ambiguous mappings stay pending.
    Does not auto-mark teacher_reviewed. Does not invent past-paper provenance.
    """
    out_dir = get_paths().data / "curriculum" / "imports"
    out_dir.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "dry_run": dry_run,
        "curriculum_version_target": CURRICULUM_VERSION,
        "resources": None,
        "questions": None,
    }
    if resources_csv and Path(resources_csv).exists():
        seen: set[str] = set()
        rows = list(csv.DictReader(Path(resources_csv).open(encoding="utf-8")))
        errs: list[str] = []
        pending_map: list[str] = []
        for r in rows:
            if r.get("legacy_topic_id") and not r.get("topic_ids"):
                pending_map.append(r.get("resource_id") or "?")
            errs.extend(validate_resource_row(r, seen=seen))
            r.pop("_soft_warnings", None)
        report["resources"] = {
            "n_rows": len(rows),
            "n_errors": len(errs),
            "error_sample": errs[:20],
            "ambiguous_mapping_pending": pending_map[:20],
            "ok": len(errs) == 0 and not pending_map,
        }
        if not dry_run and report["resources"]["ok"]:
            dest = out_dir / f"resources_{CURRICULUM_VERSION}.csv"
            with dest.open("w", encoding="utf-8", newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else RESOURCE_REQUIRED)
                w.writeheader()
                w.writerows(rows)
            report["resources"]["staged_path"] = str(dest)
    if questions_csv and Path(questions_csv).exists():
        seen_q: set[str] = set()
        rows = list(csv.DictReader(Path(questions_csv).open(encoding="utf-8")))
        errs = []
        for r in rows:
            errs.extend(validate_question_row(r, seen=seen_q))
        report["questions"] = {
            "n_rows": len(rows),
            "n_errors": len(errs),
            "error_sample": errs[:20],
            "ok": len(errs) == 0,
            "note": "Answer keys stay server-side at serve time; import retains keys for scoring only",
        }
        if not dry_run and report["questions"]["ok"]:
            dest = out_dir / f"questions_{CURRICULUM_VERSION}.csv"
            with dest.open("w", encoding="utf-8", newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else QUESTION_REQUIRED)
                w.writeheader()
                w.writerows(rows)
            report["questions"]["staged_path"] = str(dest)
    save_json(report, get_paths().reports / "catalogue_import_validation.json")
    return report


if __name__ == "__main__":
    print(json.dumps(validate_synthetic_catalogue(), indent=2)[:2000])
