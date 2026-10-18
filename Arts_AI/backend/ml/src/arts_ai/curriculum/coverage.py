"""Syllabus coverage matrix — structure ≠ teaching content ≠ verified assessment ≠ review.

Counting rules (unique topic_id / learning_outcome_id denominators within provisional scope):
- Do not count partial_match / unmapped synthetic items as verified curriculum coverage.
- Do not equate question/document/eval-case counts with unique-topic coverage.
- Denominator = in-scope provisional topics (excludes placeholders). Not a verified national syllabus.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from arts_ai.common.manifests import save_json
from arts_ai.common.paths import get_paths
from arts_ai.curriculum.registry import load_registry


def _corpus_docs() -> list[dict[str, Any]]:
    root = get_paths().arts_content
    docs: list[dict[str, Any]] = []
    reg = root / "corpus_registry.json"
    if reg.exists():
        docs.extend(json.loads(reg.read_text(encoding="utf-8")).get("documents", []))
    approved = root / "approved"
    if approved.exists():
        for meta in approved.glob("*.meta.json"):
            docs.append(json.loads(meta.read_text(encoding="utf-8")))
    by_id: dict[str, dict[str, Any]] = {}
    for d in docs:
        did = d.get("document_id")
        if did:
            by_id[did] = d
    return list(by_id.values())


def _catalogue_ids(kind: str) -> set[str]:
    syn = get_paths().synthetic
    dirs = sorted([p for p in syn.iterdir() if p.is_dir() and (p / "dataset_manifest.json").exists()])
    if not dirs:
        return set()
    preferred = next((d for d in dirs if d.name.startswith("arts_al_baseline")), dirs[-1])
    import csv

    path = preferred / ("resources.csv" if kind == "resources" else "questions.csv")
    if not path.exists():
        return set()
    with path.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return {r.get("topic_id") for r in rows if r.get("topic_id")}


def _legacy_maps() -> tuple[dict[str, str], set[str], set[str]]:
    """Returns (partial_match legacy→canonical, unmapped legacy ids, exact/reviewed legacy)."""
    reg = load_registry()
    partial: dict[str, str] = {}
    unmapped: set[str] = set()
    verified_map: set[str] = set()
    for m in reg.get("legacy_topic_mappings", []):
        st = m.get("status")
        leg = m.get("legacy_topic_id")
        can = m.get("canonical_topic_id")
        if st == "partial_match" and can:
            partial[leg] = can
        elif st == "unmapped":
            unmapped.add(leg)
        elif st in {"exact_match", "reviewed_equivalent"} and can:
            verified_map.add(leg)
            partial[leg] = can  # still usable for soft joins, but verified separately
    return partial, unmapped, verified_map


def _lo_basis(topic: dict[str, Any]) -> str:
    """Classify learning-outcome claims; official only with traceable source + non-template text."""
    explicit = topic.get("learning_outcome_basis")
    if explicit in {
        "official_with_source",
        "draft_inferred",
        "none",
        "official_nie_competency_paraphrase",
    }:
        if explicit == "official_nie_competency_paraphrase":
            return "draft_inferred"  # paraphrase ≠ verified official LO text
        return explicit
    los = topic.get("learning_outcomes") or []
    if not los:
        return "none"
    src = (topic.get("source_reference") or "").strip()
    sec = (topic.get("source_page_or_section") or "").strip()
    template = all(
        str(lo).startswith("Demonstrate understanding of:")
        or str(lo).startswith("Demonstrate competency related to:")
        for lo in los
    )
    if template or not src or not sec or sec.lower() in {"n/a", "pending"}:
        return "draft_inferred"
    # Structure section present but LO wording not verified verbatim from PDF extract
    if "competency" in sec.lower() or sec.startswith("§"):
        return "draft_inferred"
    return "draft_inferred"


def build_coverage_matrix() -> dict[str, Any]:
    reg = load_registry()
    topics = [t for t in reg["topics"] if t.get("topic_id") != "si_lit_placeholder"]
    docs = _corpus_docs()
    partial_map, unmapped_legacy, verified_legacy = _legacy_maps()

    docs_by_topic: dict[str, list[str]] = defaultdict(list)
    for d in docs:
        tid = d.get("topic_id")
        if not tid:
            continue
        canon = partial_map.get(tid, tid)
        docs_by_topic[canon].append(d.get("document_id") or "?")

    res_legacy = _catalogue_ids("resources")
    q_legacy = _catalogue_ids("questions")
    # Soft (partial_match) vs verified mapping
    res_partial = {partial_map[t] for t in res_legacy if t in partial_map}
    q_partial = {partial_map[t] for t in q_legacy if t in partial_map}
    res_verified = {partial_map[t] for t in res_legacy if t in verified_legacy}
    q_verified = {partial_map[t] for t in q_legacy if t in verified_legacy}

    domain_topics: set[str] = set()
    try:
        from arts_ai.c4_chatbot.knowledge_ingest import load_domain_index

        idx = load_domain_index()
        if idx:
            for c in idx.chunks:
                tid = c.get("topic_id")
                if tid:
                    domain_topics.add(partial_map.get(str(tid), str(tid)))
    except Exception:  # noqa: BLE001
        pass

    eval_topic_ids: set[str] = set()
    eval_path = get_paths().arts_content / "eval" / "domain_retrieval_eval_cases.json"
    eval_meta: dict[str, Any] = {}
    if eval_path.exists():
        eval_doc = json.loads(eval_path.read_text(encoding="utf-8"))
        eval_meta = {
            "path": "backend/ml/data/arts_content/eval/domain_retrieval_eval_cases.json",
            "curriculum_version": eval_doc.get("curriculum_version"),
            "n_cases": eval_doc.get("n_cases"),
            "authoring_provenance": eval_doc.get("authoring_provenance"),
        }
        for c in eval_doc.get("cases") or []:
            tid = c.get("topic_id")
            if tid:
                eval_topic_ids.add(partial_map.get(tid, tid))

    rows = []
    missing_content: list[dict[str, Any]] = []
    for t in topics:
        tid = t["topic_id"]
        los = t.get("learning_outcomes") or []
        lo_basis = _lo_basis(t)
        doc_ids = docs_by_topic.get(tid, [])
        permitted_docs = [
            d for d in docs if d.get("document_id") in doc_ids and d.get("usage_permitted")
        ]
        # LO support: exact string overlap, or declared supported LOs on mapped docs
        supported_los = set()
        for d in permitted_docs:
            for lo in d.get("learning_outcomes_supported") or []:
                supported_los.add(str(lo).strip())
        n_lo_supported = sum(1 for lo in los if str(lo).strip() in supported_los)
        if n_lo_supported == 0 and supported_los and los:
            # Declared mapping exists but wording differs from registry paraphrase
            n_lo_supported = 0
            lo_support_basis = "content_declares_outcomes_unverified_string_match"
        else:
            lo_support_basis = "exact_string_overlap" if n_lo_supported else "none"
        # Count topic as having LO-linked content when docs declare outcomes for the topic
        lo_content_linked = n_lo_supported > 0 or (bool(supported_los) and bool(permitted_docs))

        row = {
            "curriculum_version": t["curriculum_version"],
            "subject_id": t["subject_id"],
            "grade": t["grade"],
            "medium": t["medium"],
            "topic_id": tid,
            "topic_title": t["topic_title"],
            "source_reference": t.get("source_reference"),
            "source_page_or_section": t.get("source_page_or_section"),
            "registry_structure_recorded": True,
            "official_learning_outcomes_recorded": lo_basis == "official_with_source",
            "draft_or_inferred_learning_outcomes": lo_basis == "draft_inferred",
            "n_learning_outcomes": len(los),
            "n_learning_outcomes_exact_string_match": n_lo_supported,
            "learning_outcomes_supported_by_content": lo_content_linked,
            "learning_outcome_support_basis": lo_support_basis,
            "supplemental_teaching_content_mapped": len(permitted_docs) > 0,
            "content_document_ids": [d.get("document_id") for d in permitted_docs],
            "content_source_usage_basis": (
                permitted_docs[0].get("usage_permission_or_license") if permitted_docs else None
            ),
            "extraction_quality_checked": any(
                (d.get("extraction_quality") or {}).get("ok")
                or d.get("extraction_quality_status") == "ok"
                for d in permitted_docs
            ),
            "language": t["medium"],
            "synthetic_draft_questions_partial_mapped": tid in q_partial,
            "synthetic_draft_resources_partial_mapped": tid in res_partial,
            "verified_curriculum_aligned_questions": tid in q_verified,
            "verified_curriculum_aligned_resources": tid in res_verified,
            "teacher_reviewed_content": any(
                d.get("review_status") == "teacher_reviewed" and d.get("review_evidence")
                for d in permitted_docs
            ),
            "retrieval_evaluation_coverage": tid in eval_topic_ids or any(
                d.get("document_id") in eval_topic_ids for d in permitted_docs
            )
            or tid in eval_topic_ids,
            "chat_retrieval_index_has_topic": tid in domain_topics or bool(permitted_docs),
            "counting_note": (
                "partial_match synthetic catalogue ≠ verified curriculum coverage; "
                "supplemental Wikipedia ≠ complete A/L teaching corpus"
            ),
        }
        # Fix retrieval_evaluation_coverage: topic in eval cases OR docs used as gold
        gold_docs = set()
        if eval_path.exists():
            for c in json.loads(eval_path.read_text(encoding="utf-8")).get("cases") or []:
                gold_docs.update(c.get("expected_document_ids") or [])
        row["retrieval_evaluation_coverage"] = tid in eval_topic_ids or any(
            d in gold_docs for d in (row["content_document_ids"] or [])
        )
        rows.append(row)
        if not row["supplemental_teaching_content_mapped"]:
            missing_content.append(
                {
                    "topic_id": tid,
                    "subject_id": t["subject_id"],
                    "grade": t["grade"],
                    "medium": t["medium"],
                    "topic_title": t["topic_title"],
                    "source_reference": t.get("source_reference"),
                    "needed": "permitted_teaching_material_with_canonical_topic_mapping",
                }
            )

    den = len(rows)

    def _rate(pred) -> dict[str, Any]:
        num = sum(1 for r in rows if pred(r))
        return {"numerator": num, "denominator": den, "rate": (num / den) if den else None}

    overall = {
        "registry_structure_recorded": _rate(lambda r: r["registry_structure_recorded"]),
        "official_learning_outcomes_recorded": _rate(
            lambda r: r["official_learning_outcomes_recorded"]
        ),
        "draft_or_inferred_learning_outcomes": _rate(
            lambda r: r["draft_or_inferred_learning_outcomes"]
        ),
        "supplemental_teaching_content_mapped": _rate(
            lambda r: r["supplemental_teaching_content_mapped"]
        ),
        "learning_outcomes_supported_by_content": _rate(
            lambda r: r["learning_outcomes_supported_by_content"]
        ),
        "synthetic_draft_questions_partial_mapped": _rate(
            lambda r: r["synthetic_draft_questions_partial_mapped"]
        ),
        "synthetic_draft_resources_partial_mapped": _rate(
            lambda r: r["synthetic_draft_resources_partial_mapped"]
        ),
        "verified_curriculum_aligned_questions": _rate(
            lambda r: r["verified_curriculum_aligned_questions"]
        ),
        "verified_curriculum_aligned_resources": _rate(
            lambda r: r["verified_curriculum_aligned_resources"]
        ),
        "teacher_reviewed_content": _rate(lambda r: r["teacher_reviewed_content"]),
        "retrieval_evaluation_coverage": _rate(lambda r: r["retrieval_evaluation_coverage"]),
    }

    def _group(key: str) -> dict[str, Any]:
        groups: dict[str, list] = defaultdict(list)
        for r in rows:
            groups[str(r[key])].append(r)
        out = {}
        for g, srows in sorted(groups.items()):
            d = len(srows)
            out[g] = {
                "n_topics": d,
                "supplemental_teaching_content_mapped": {
                    "numerator": sum(1 for r in srows if r["supplemental_teaching_content_mapped"]),
                    "denominator": d,
                },
                "teacher_reviewed_content": {
                    "numerator": sum(1 for r in srows if r["teacher_reviewed_content"]),
                    "denominator": d,
                },
                "verified_curriculum_aligned_questions": {
                    "numerator": sum(1 for r in srows if r["verified_curriculum_aligned_questions"]),
                    "denominator": d,
                },
                "synthetic_draft_questions_partial_mapped": {
                    "numerator": sum(
                        1 for r in srows if r["synthetic_draft_questions_partial_mapped"]
                    ),
                    "denominator": d,
                },
                "official_learning_outcomes_recorded": {
                    "numerator": sum(1 for r in srows if r["official_learning_outcomes_recorded"]),
                    "denominator": d,
                },
            }
        return out

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "curriculum_version": reg["curriculum_version"],
        "scope_status": reg.get("scope_status"),
        "scope_note": (
            "Denominator is the provisional demo scope (nie_al_arts_provisional_v0.1), "
            "not a verified complete national A/L Arts syllabus."
        ),
        "counting_rules": {
            "unit": "unique topic_id within provisional in-scope set",
            "excluded_placeholders": ["si_lit_placeholder"],
            "partial_match_not_verified": True,
            "unmapped_not_coverage": True,
            "question_count_neq_topic_coverage": True,
            "document_count_neq_topic_coverage": True,
        },
        "n_topics_in_scope": den,
        "legacy_mapping_status_counts": {
            "partial_match": len(partial_map),
            "unmapped": len(unmapped_legacy),
            "exact_or_reviewed_equivalent": len(verified_legacy),
        },
        "eval_set": eval_meta,
        "overall": overall,
        "by_subject": _group("subject_id"),
        "by_grade": _group("grade"),
        "by_language_medium": _group("medium"),
        "missing_permitted_teaching_material": missing_content,
        "n_missing_permitted_teaching_material": len(missing_content),
        "honest_non_claim": (
            "Do not report 100% syllabus coverage. Official LO text, teacher review, and "
            "verified curriculum-aligned assessment remain essentially empty under current evidence."
        ),
        "rows": rows,
    }

    out_json = get_paths().reports / "curriculum_coverage_matrix.json"
    save_json(report, out_json)

    lines = [
        f"# Curriculum coverage summary ({reg['curriculum_version']})",
        "",
        f"Generated: {report['generated_at_utc']}",
        "",
        f"Provisional in-scope topics (excl. placeholders): **{den}**",
        "",
        report["scope_note"],
        "",
        "## Counting rules",
        "",
        "- Unit = unique `topic_id` in provisional scope.",
        "- `partial_match` / `unmapped` synthetic catalogue items are **not** verified curriculum coverage.",
        "- Question/document/eval-case counts ≠ unique-topic coverage.",
        "",
        "| Category | Numerator / Denominator |",
        "|----------|-------------------------|",
    ]
    for k, v in overall.items():
        lines.append(f"| {k} | {v['numerator']} / {v['denominator']} |")
    lines.extend(["", "## By subject", ""])
    for sid, s in report["by_subject"].items():
        tm = s["supplemental_teaching_content_mapped"]
        tr = s["teacher_reviewed_content"]
        vq = s["verified_curriculum_aligned_questions"]
        lines.append(
            f"- **{sid}**: topics={s['n_topics']}; "
            f"supplemental_content={tm['numerator']}/{tm['denominator']}; "
            f"teacher_reviewed={tr['numerator']}/{tr['denominator']}; "
            f"verified_questions={vq['numerator']}/{vq['denominator']}"
        )
    lines.extend(["", "## By grade", ""])
    for g, s in report["by_grade"].items():
        tm = s["supplemental_teaching_content_mapped"]
        lines.append(
            f"- **grade {g}**: topics={s['n_topics']}; supplemental_content={tm['numerator']}/{tm['denominator']}"
        )
    lines.extend(["", "## By medium", ""])
    for g, s in report["by_language_medium"].items():
        tm = s["supplemental_teaching_content_mapped"]
        lines.append(
            f"- **{g}**: topics={s['n_topics']}; supplemental_content={tm['numerator']}/{tm['denominator']}"
        )
    lines.extend(
        [
            "",
            f"Missing permitted teaching material for **{len(missing_content)}** topics "
            f"(see matrix `missing_permitted_teaching_material`).",
            "",
            report["honest_non_claim"],
            "",
            f"Machine-readable: `backend/ml/reports/{out_json.name}`",
        ]
    )
    summary = "\n".join(lines) + "\n"
    (get_paths().reports / "curriculum_coverage_summary.md").write_text(summary, encoding="utf-8")
    (get_paths().data / "curriculum" / "coverage_summary.md").write_text(summary, encoding="utf-8")
    # Persist missing checklist
    save_json(
        {
            "generated_at_utc": report["generated_at_utc"],
            "curriculum_version": reg["curriculum_version"],
            "n_missing": len(missing_content),
            "topics": missing_content,
        },
        get_paths().arts_content / "MISSING_CONTENT_CHECKLIST.json",
    )
    return report


if __name__ == "__main__":
    r = build_coverage_matrix()
    print(
        json.dumps(
            {
                "n_topics": r["n_topics_in_scope"],
                "official_los": r["overall"]["official_learning_outcomes_recorded"],
                "draft_los": r["overall"]["draft_or_inferred_learning_outcomes"],
                "supplemental_content": r["overall"]["supplemental_teaching_content_mapped"],
                "verified_questions": r["overall"]["verified_curriculum_aligned_questions"],
                "synthetic_partial_questions": r["overall"][
                    "synthetic_draft_questions_partial_mapped"
                ],
                "teacher_reviewed": r["overall"]["teacher_reviewed_content"],
            },
            indent=2,
        )
    )
