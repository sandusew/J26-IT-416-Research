"""Topic-level coverage from authored packages + optional Mongo catalogue counts."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP = ROOT / "data/arts_content/practice/topic_source_map.json"
PACKAGES = ROOT / "data/arts_content/practice/packages"
OUT_JSON = ROOT / "reports/practice_topic_coverage.json"
OUT_MD = ROOT / "reports/practice_topic_coverage.md"
DOCS_MD = ROOT.parents[1] / "docs" / "CURRICULUM_COVERAGE_SUMMARY.md"


def main() -> None:
    smap = json.loads(MAP.read_text(encoding="utf-8"))
    rows = []
    for t in smap["topics"]:
        tid = t["topic_id"]
        pkg = PACKAGES / tid
        batch_p = pkg / "import_batch.json"
        man_p = pkg / "package_manifest.json"
        n_q = 0
        n_src = 0
        status = "missing_package"
        if batch_p.exists() and man_p.exists():
            batch = json.loads(batch_p.read_text(encoding="utf-8"))
            man = json.loads(man_p.read_text(encoding="utf-8"))
            n_q = len(batch.get("questions") or [])
            n_src = len(man.get("source_ids") or [])
            status = "package_ready" if n_q >= 12 else "package_partial"
        rows.append(
            {
                "topic_id": tid,
                "subject_id": t["subject_id"],
                "topic_title": t["topic_title"],
                "scope_status": "provisional_implementation_assumption",
                "objectives": "inferred_not_official_verbatim",
                "teaching_package": status.startswith("package"),
                "source_count": n_src,
                "published_practice_questions_authored": n_q,
                "authentic_questions": 0,
                "ai_authored_questions": n_q,
                "human_reviewed_questions": 0,
                "quiz_availability": "eligible_after_publish_practice" if n_q >= 12 else "blocked",
                "retrieval_coverage": "indexed_if_package_ingested" if status.startswith("package") else "none",
                "remaining_gaps": []
                if n_q >= 12
                else ["need_teaching_package_and_12_questions"],
                "status": status,
            }
        )
    n_ready = sum(1 for r in rows if r["status"] == "package_ready")
    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "curriculum_version": smap["curriculum_version"],
        "medium": "english",
        "scope_note": smap.get("scope_note"),
        "sinhala_literature": "deferred",
        "n_topics_in_scope": len(rows),
        "n_topics_with_usable_packages": n_ready,
        "n_ai_authored_questions": sum(r["ai_authored_questions"] for r in rows),
        "n_authentic_questions": 0,
        "n_human_reviewed_questions": 0,
        "n_teaching_packages": n_ready,
        "topics": rows,
        "note": (
            "Counts are from authored package files. "
            "Publication and authentic/teacher-reviewed counters are separate axes. "
            "Not national syllabus completion."
        ),
    }
    OUT_JSON.write_text(json.dumps(report, indent=2), encoding="utf-8")
    lines = [
        "# Practice content coverage (provisional English scope)",
        "",
        f"Generated: {report['generated_at_utc']}",
        "",
        f"- In-scope topics: **{report['n_topics_in_scope']}** (Sinhala Literature deferred)",
        f"- Usable teaching packages: **{report['n_topics_with_usable_packages']}**",
        f"- AI-authored practice questions (authored/validated): **{report['n_ai_authored_questions']}**",
        f"- Authentic approved questions: **0**",
        f"- Teacher-reviewed questions: **0**",
        "",
        "| Topic | Subject | Package | AI Qs | Status |",
        "|-------|---------|---------|-------|--------|",
    ]
    for r in rows:
        lines.append(
            f"| `{r['topic_id']}` | {r['subject_id']} | {'yes' if r['teaching_package'] else 'no'} | {r['ai_authored_questions']} | {r['status']} |"
        )
    lines.extend(
        [
            "",
            "## Honesty labels",
            "",
            "- Implementation assumption — not stakeholder-approved complete national coverage.",
            "- AI-authored practice is source-grounded and automatically checked; **not** teacher-reviewed.",
            "- Official NIE learning-outcome verbatim extracts are not claimed.",
            "",
        ]
    )
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    # Append brief pointer into docs coverage summary if present
    if DOCS_MD.exists():
        pointer = (
            "\n\n## Practice bank population (2026-10-14)\n\n"
            f"- Usable packages: {n_ready}/{len(rows)} in-scope English topics\n"
            f"- AI-authored questions authored: {report['n_ai_authored_questions']}\n"
            f"- Authentic approved / teacher-reviewed: still 0\n"
            f"- Detail: `backend/ml/reports/practice_topic_coverage.md`\n"
            "- Domain index includes practice packages + prior wiki extracts "
            "(`c4_index_20261014T173535_894e48ef` after ingest).\n"
        )
        text = DOCS_MD.read_text(encoding="utf-8")
        if "Practice bank population (2026-10-14)" not in text:
            DOCS_MD.write_text(text.rstrip() + pointer, encoding="utf-8")
    print(json.dumps({k: report[k] for k in report if k != "topics"}, indent=2))


if __name__ == "__main__":
    main()
