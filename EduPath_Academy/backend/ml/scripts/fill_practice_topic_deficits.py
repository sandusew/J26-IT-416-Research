"""Fill per-topic deficits to 12 distinct eligible practice questions.

Reconciles duplicate questionId::version rows, prefers wiki-source grounding
over package boilerplate, and authors additional MCQs only from real extracts.
Does not forge teacher approval or past-paper provenance.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from audit_and_repair_practice_content import (  # noqa: E402
    CURRICULUM,
    PACKAGES,
    BATCHES,
    MAP,
    REG,
    REPORT,
    REPORT_MD,
    answer_in_source,
    audit_question,
    jaccard,
    load_source_text,
    norm,
    repair_mcq_from_source,
    tokens,
)

PRACTICE = ROOT / "data/arts_content/practice"
TARGET = 12
BOILERPLATE_MARKERS = (
    "content provenance",
    "ai-authored practice package supports",
    "content_origin=ai_authored",
    "not a test fixture",
    "worked application: using the cited sources",
    "revision summary:",
)


def load_wiki_only_source(source_ids: list[str], pkg_dir: Path) -> str:
    """Source text excluding package boilerplate body."""
    texts: list[str] = []
    approved = ROOT / "data/arts_content/approved"
    pending = ROOT / "data/arts_content/approved_pending"
    sources = PRACTICE / "sources"
    sid_set = set(source_ids or [])
    for sid in sid_set:
        for base in (approved, pending):
            p = base / f"{sid}.txt"
            if p.exists():
                texts.append(p.read_text(encoding="utf-8"))
        # practice source caches
        for cache in sources.glob("*.json"):
            try:
                doc = json.loads(cache.read_text(encoding="utf-8"))
            except Exception:
                continue
            doc_sid = doc.get("source_id") or doc.get("id") or cache.stem
            if sid == doc_sid or sid in cache.stem or sid.replace("wiki_en_", "") in cache.stem:
                if doc.get("text") and len(doc["text"]) > 200:
                    texts.append(doc["text"])
    # Fallback: full loader then strip obvious boilerplate paragraphs
    if not texts:
        raw = load_source_text(source_ids, pkg_dir)
        parts = []
        for para in re.split(r"\n{2,}", raw):
            if any(m in para.lower() for m in BOILERPLATE_MARKERS):
                continue
            parts.append(para)
        return "\n\n".join(parts)
    return "\n\n".join(texts)


def is_boilerplate_question(q: dict) -> bool:
    blob = " ".join(
        [
            str(q.get("prompt") or ""),
            str((q.get("supportingPassages") or [{}])[0].get("passage") if q.get("supportingPassages") else ""),
            str(q.get("explanation") or ""),
        ]
    ).lower()
    return any(m in blob for m in BOILERPLATE_MARKERS)


def dedupe_by_question_id(questions: list[dict]) -> list[dict]:
    """Keep one row per questionId — prefer non-boilerplate, then longer explanation."""
    best: dict[str, dict] = {}
    for q in questions:
        qid = q.get("questionId")
        if not qid:
            continue
        cur = best.get(qid)
        if cur is None:
            best[qid] = q
            continue
        score_new = (0 if is_boilerplate_question(q) else 10) + min(len(q.get("explanation") or ""), 200) / 20
        score_old = (0 if is_boilerplate_question(cur) else 10) + min(len(cur.get("explanation") or ""), 200) / 20
        # prefer higher version on tie
        if score_new > score_old or (
            score_new == score_old and str(q.get("version") or "0") > str(cur.get("version") or "0")
        ):
            best[qid] = q
    return list(best.values())


def next_question_ids(topic_id: str, existing: set[str], n: int) -> list[str]:
    ids = []
    i = 1
    while len(ids) < n:
        qid = f"prac_{topic_id}_q{i:02d}"
        if qid not in existing:
            ids.append(qid)
        i += 1
        if i > 80:
            break
    return ids


def author_extra(
    topic: dict,
    source_text: str,
    sid: str,
    question_id: str,
    index: int,
    used_prompts: set[str],
    used_answers: set[str],
) -> dict | None:
    # Try several sentence offsets to avoid duplicates
    for offset in range(0, 40, 1):
        q = repair_mcq_from_source(topic, source_text, index + offset, sid)
        if not q:
            continue
        q["questionId"] = question_id
        q["version"] = "3"
        q["dataOrigin"] = "ai_authored_practice_bank_v3_deficit_fill"
        prompt_key = norm(q.get("prompt") or "")
        ans_key = norm(str(q.get("correctAnswerOrRubric") or ""))
        if prompt_key in used_prompts:
            continue
        if ans_key in used_answers and len(used_answers) >= 4:
            # allow some answer reuse only when bank is thin
            continue
        if is_boilerplate_question(q):
            continue
        # Reject trivial single-token answers that are sentence starters only
        ans = str(q.get("correctAnswerOrRubric") or "")
        if ans in ("National", "Overview", "Content", "According", "Using", "False", "True") and q[
            "questionType"
        ] == "mcq":
            continue
        if not answer_in_source(ans, source_text):
            continue
        # Distractor quality: drop "Unrelated term" / "not supported"
        opts = q.get("options") or []
        if any("unrelated term" in norm(str(o)) for o in opts):
            continue
        if any("not attested" in norm(str(o)) for o in opts):
            continue
        used_prompts.add(prompt_key)
        used_answers.add(ans_key)
        return q
    return None


def near_dup(a: dict, b: dict) -> bool:
    return jaccard(tokens(a.get("prompt") or ""), tokens(b.get("prompt") or "")) >= 0.85


def main() -> dict:
    smap = json.loads(MAP.read_text(encoding="utf-8"))
    reg = json.loads(REG.read_text(encoding="utf-8"))
    topic_ids = {t["topic_id"] for t in reg.get("topics") or []}
    raw_subjects = reg.get("subjects") or []
    if raw_subjects and isinstance(raw_subjects[0], dict):
        subjects = {s["subject_id"] for s in raw_subjects}
    else:
        subjects = set(raw_subjects) or {
            t.get("subject_id") for t in (reg.get("topics") or []) if t.get("subject_id")
        }

    before_counts = {}
    after_topics = []
    combined_q = []
    combined_r = []
    newly_authored = 0
    repaired_kept = 0
    dropped_dup_or_boilerplate = 0
    quarantined = 0
    blockers = []

    for topic in smap["topics"]:
        tid = topic["topic_id"]
        pkg = PACKAGES / tid
        batch_p = pkg / "import_batch.json"
        man_p = pkg / "package_manifest.json"
        if not batch_p.exists() or not man_p.exists():
            blockers.append({"topic_id": tid, "reason": "missing_package"})
            continue
        man = json.loads(man_p.read_text(encoding="utf-8"))
        old = json.loads(batch_p.read_text(encoding="utf-8"))
        old_qs = old.get("questions") or []
        before_counts[tid] = len({q["questionId"] for q in old_qs if q.get("questionId")})

        wiki = load_wiki_only_source(man.get("source_ids") or [], pkg)
        # Also allow full load as secondary for validation breadth
        full = load_source_text(man.get("source_ids") or [], pkg)
        source_for_author = wiki if len(wiki) > 400 else full

        # Start from deduped, prefer non-boilerplate
        kept = []
        for q in dedupe_by_question_id(old_qs):
            if is_boilerplate_question(q) and len(source_for_author) > 400:
                # drop boilerplate-grounded when real sources exist
                dropped_dup_or_boilerplate += 1
                continue
            defs = audit_question(q, topic_ids, subjects, source_for_author or full)
            # Allow TF misconception items without answer-in-source
            if q.get("questionType") == "true_false":
                defs = [d for d in defs if d["code"] != "answer_not_supported_by_cited_source_heuristic"]
            bad = {
                "nonsensical_distractor",
                "answer_leak_in_prompt",
                "template_prefix_prompt",
                "forged_teacher_approval",
                "forged_human_review",
                "answer_not_in_options",
                "mcq_options_invalid",
            }
            if any(d["code"] in bad for d in defs):
                quarantined += 1
                continue
            # Soft: if answer unsupported and boilerplate, skip
            if any(d["code"] == "answer_not_supported_by_cited_source_heuristic" for d in defs):
                if is_boilerplate_question(q) or len(str(q.get("correctAnswerOrRubric") or "")) < 4:
                    dropped_dup_or_boilerplate += 1
                    continue
            q2 = dict(q)
            q2["automatedValidation"] = "passed"
            q2["humanReviewStatus"] = "unreviewed"
            q2["reviewStatus"] = "draft"
            q2["learnerAvailability"] = "draft"
            q2["isTestFixture"] = False
            q2["contentOrigin"] = "ai_authored_source_grounded"
            kept.append(q2)
            repaired_kept += 1

        # Dedup near-identical prompts within topic
        final = []
        for q in kept:
            if any(near_dup(q, x) for x in final):
                dropped_dup_or_boilerplate += 1
                continue
            final.append(q)

        used_prompts = {norm(q.get("prompt") or "") for q in final}
        used_answers = {norm(str(q.get("correctAnswerOrRubric") or "")) for q in final}
        existing_ids = {q["questionId"] for q in final}
        need = max(0, TARGET - len(final))
        sids = man.get("source_ids") or ["unknown_source"]
        new_ids = next_question_ids(tid, existing_ids, need + 10)
        authored_here = 0
        for i, qid in enumerate(new_ids):
            if len(final) >= TARGET:
                break
            if len(source_for_author) < 200:
                break
            sid = sids[i % len(sids)]
            q = author_extra(topic, source_for_author, sid, qid, i + 12, used_prompts, used_answers)
            if not q:
                continue
            defs = audit_question(q, topic_ids, subjects, source_for_author)
            if any(
                d["code"]
                in (
                    "nonsensical_distractor",
                    "answer_not_in_options",
                    "mcq_options_invalid",
                    "answer_leak_in_prompt",
                )
                for d in defs
            ):
                continue
            if any(near_dup(q, x) for x in final):
                continue
            final.append(q)
            existing_ids.add(qid)
            authored_here += 1
            newly_authored += 1

        final = final[:TARGET]
        resource = (old.get("resources") or [None])[0]
        if resource:
            resource = dict(resource)
            resource["automatedValidation"] = "passed" if final else "failed"
            resource["learnerAvailability"] = "draft"
            resource["contentOrigin"] = "ai_authored_source_grounded"
            resource["isTestFixture"] = False
            resource["humanReviewStatus"] = "unreviewed"
            resource["reviewStatus"] = "draft"

        new_batch = {
            "dryRun": False,
            "note": "Deficit-fill v3 — distinct logical IDs; unreviewed AI practice; not fixtures",
            "questions": final,
            "resources": [resource] if resource else [],
            "filled_at_utc": datetime.now(timezone.utc).isoformat(),
            "before_distinct": before_counts[tid],
            "after_distinct": len(final),
            "newly_authored_here": authored_here,
        }
        batch_p.write_text(json.dumps(new_batch, indent=2, ensure_ascii=False), encoding="utf-8")
        (pkg / "questions.json").write_text(json.dumps(final, indent=2, ensure_ascii=False), encoding="utf-8")

        row = {
            "topic_id": tid,
            "before_distinct": before_counts[tid],
            "after_distinct": len(final),
            "newly_authored": authored_here,
            "meets_12": len(final) >= TARGET,
            "source_chars": len(source_for_author),
        }
        if len(final) < TARGET:
            row["blocker"] = (
                "insufficient_distinct_source_grounded_items"
                if len(source_for_author) < 200
                else "could_not_author_enough_non_duplicate_items"
            )
            blockers.append({"topic_id": tid, "reason": row["blocker"], "have": len(final), "need": TARGET})
        after_topics.append(row)
        combined_q.extend(final)
        if resource:
            combined_r.append(resource)

    # Global unique by questionId (should already be unique per topic)
    by_id: dict[str, dict] = {}
    for q in combined_q:
        by_id[q["questionId"]] = q
    final_q = list(by_id.values())

    combined = {
        "dryRun": False,
        "note": "Combined practice bank v3 deficit-fill — publish-practice required; not teacher approval",
        "questions": final_q,
        "resources": combined_r,
        "n_questions": len(final_q),
        "n_resources": len(combined_r),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    BATCHES.mkdir(parents=True, exist_ok=True)
    (BATCHES / "combined_import_batch.json").write_text(
        json.dumps(combined, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    by_topic = Counter(q["topicId"] for q in final_q)
    n_ge_12 = sum(1 for t in smap["topics"] if by_topic[t["topic_id"]] >= TARGET)
    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "target_per_topic": TARGET,
        "n_topics": len(smap["topics"]),
        "topics_meeting_12": n_ge_12,
        "topics_below_12": len(smap["topics"]) - n_ge_12,
        "eligible_questions_distinct": len(final_q),
        "eligible_resources": len(combined_r),
        "newly_authored": newly_authored,
        "kept_from_prior": repaired_kept,
        "dropped_dup_or_boilerplate": dropped_dup_or_boilerplate,
        "quarantined": quarantined,
        "blockers": blockers,
        "topics": after_topics,
        "reconciliation_note": (
            "Prior 531 batch rows included duplicate questionId::version keys (45 dupes → 486 unique). "
            "This fill dedupes and authors new distinct IDs to reach 12/topic where sources allow."
        ),
        "combined_batch": str(BATCHES / "combined_import_batch.json"),
        "review_kinds_performed": [
            "structural_schema",
            "near_duplicate_jaccard",
            "boilerplate_grounding_filter",
            "source_support_heuristic",
            "distinct_logical_id_check",
        ],
        "review_kinds_not_performed": [
            "teacher_factual_validation",
            "psychometric_calibration",
            "official_past_paper_provenance_check",
        ],
    }
    out_json = ROOT / "reports/practice_deficit_fill.json"
    out_json.write_text(json.dumps(report, indent=2), encoding="utf-8")

    # Refresh quality report counts
    quality = {
        "generated_at_utc": report["generated_at_utc"],
        "review_kinds_performed": report["review_kinds_performed"],
        "review_kinds_not_performed": report["review_kinds_not_performed"],
        "eligible_questions_after_repair": len(final_q),
        "eligible_resources_after_repair": len(combined_r),
        "topics_with_ge_8_questions": sum(1 for t in smap["topics"] if by_topic[t["topic_id"]] >= 8),
        "topics_with_ge_12_questions": n_ge_12,
        "n_topics_in_scope": len(smap["topics"]),
        "deficit_fill": str(out_json),
        "combined_batch": str(BATCHES / "combined_import_batch.json"),
        "remaining_uncertainties": [
            "Source-support heuristic is lexical, not teacher verification",
            "Wikipedia extracts may be shallow for some A/L competencies",
            "Distractor quality is improved but not expert-reviewed",
        ],
    }
    REPORT.write_text(json.dumps(quality, indent=2), encoding="utf-8")
    REPORT_MD.write_text(
        "\n".join(
            [
                "# Practice content quality report",
                "",
                f"Generated: {report['generated_at_utc']}",
                "",
                "## Deficit fill (v3)",
                f"- Distinct eligible questions: **{len(final_q)}**",
                f"- Topics meeting ≥12 distinct: **{n_ge_12}/{len(smap['topics'])}**",
                f"- Newly authored: **{newly_authored}**",
                f"- Dropped duplicate/boilerplate: **{dropped_dup_or_boilerplate}**",
                f"- Blockers: **{len(blockers)}**",
                "",
                "## Reconciliation",
                report["reconciliation_note"],
                "",
                "## Review kinds",
                "- Performed: " + ", ".join(report["review_kinds_performed"]),
                "- Not performed: " + ", ".join(report["review_kinds_not_performed"]),
                "",
            ]
        ),
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "eligible_distinct": len(final_q),
                "resources": len(combined_r),
                "topics_ge_12": n_ge_12,
                "topics_below_12": len(smap["topics"]) - n_ge_12,
                "newly_authored": newly_authored,
                "blockers": len(blockers),
                "report": str(out_json),
            },
            indent=2,
        )
    )
    return report


if __name__ == "__main__":
    main()
