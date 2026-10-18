"""Audit the domain retrieval evaluation set: formulas, denominators, exclusions."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from arts_ai.common.manifests import save_json
from arts_ai.common.paths import get_paths


def main() -> dict:
    cases_path = get_paths().arts_content / "eval" / "domain_retrieval_eval_cases.json"
    result_path = get_paths().reports / "c4_domain_retrieval_eval.json"
    cases_doc = json.loads(cases_path.read_text(encoding="utf-8")) if cases_path.exists() else {}
    results = json.loads(result_path.read_text(encoding="utf-8")) if result_path.exists() else {}
    cases = cases_doc.get("cases") or []

    answerable = [
        c
        for c in cases
        if c.get("answerable")
        and c.get("expected_document_ids")
        and c.get("language") != "si"
        and not c.get("expect_wrong_subject_abstention")
    ]
    unanswerable = [c for c in cases if c.get("answerable") is False]
    excluded = []
    for c in cases:
        if c.get("language") == "si":
            excluded.append(
                {
                    "id": c["id"],
                    "reason": "sinhala_query_support_not_claimed_excluded_from_hit_denominator",
                }
            )
        if c.get("expect_wrong_subject_abstention"):
            excluded.append(
                {
                    "id": c["id"],
                    "reason": "wrong_subject_filter_probe_not_in_hit_denominator",
                }
            )

    # Recompute Hit@3 vs Recall@3 (here gold unit = document_id; at most one primary gold set)
    hit_at_3 = 0
    recall_numer = 0
    recall_denom = 0
    per_q = []
    by_id = {r["id"]: r for r in results.get("cases") or []}
    for c in answerable:
        r = by_id.get(c["id"]) or {}
        gold = set(c.get("expected_document_ids") or [])
        retrieved = r.get("retrieved_document_ids") or []
        top3 = set(retrieved[:3])
        hit = bool(gold & top3)
        if hit:
            hit_at_3 += 1
        # Recall@3 with multiple gold docs: |gold ∩ top3| / |gold|
        if gold:
            recall_numer += len(gold & top3)
            recall_denom += len(gold)
        per_q.append(
            {
                "id": c["id"],
                "answerable": True,
                "gold_unit": "document_id",
                "n_gold_docs": len(gold),
                "hit_at_3": hit,
                "recall_at_3_question": (len(gold & top3) / len(gold)) if gold else None,
                "retrieved_top3": retrieved[:3],
                "authoring_provenance": c.get("authoring_provenance"),
                "review_status": c.get("review_status"),
            }
        )

    audit = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "evaluation_id": results.get("evaluation_id"),
        "corpus_version": results.get("corpus_version"),
        "index_sha256": results.get("index_sha256"),
        "eval_cases_sha256": results.get("eval_cases_sha256"),
        "eval_cases_path": "backend/ml/data/arts_content/eval/domain_retrieval_eval_cases.json",
        "result_path": "backend/ml/reports/c4_domain_retrieval_eval.json",
        "result_generated_at_utc": results.get("generated_at_utc"),
        "total_questions": len(cases),
        "n_answerable_with_gold": len(answerable),
        "n_unanswerable": len(unanswerable),
        "exclusions": excluded,
        "gold_relevance_unit": "document_id (not passage/chunk)",
        "metric_definitions": {
            "Hit@3": "1 if any gold document_id appears in top-3 retrieved docs; denominator = answerable-with-gold",
            "Recall@3_micro": "|union over Q of (gold∩top3)| style: sum_q |gold∩top3| / sum_q |gold|",
            "prior_report_recall_at_3": results.get("recall_at_3"),
            "prior_report_note": (
                "Earlier c4_domain_retrieval_eval.json used Hit@3 rate labelled recall_at_3 "
                "(single-label Hit@k). This audit distinguishes Hit@3 from multi-gold Recall@3."
            ),
        },
        "hit_at_3": {
            "numerator": hit_at_3,
            "denominator": len(answerable),
            "value": (hit_at_3 / len(answerable)) if answerable else None,
        },
        "recall_at_3_micro": {
            "numerator": recall_numer,
            "denominator": recall_denom,
            "value": (recall_numer / recall_denom) if recall_denom else None,
        },
        "per_question": per_q,
        "teacher_reviewed_cases": 0,
        "machine_authored_cases": len(cases),
        "expansion_required": (
            "Expand held-out eval across subjects/grades/languages after scope confirmation; "
            "choose coverage before tuning; keep teacher-reviewed cases separate."
        ),
    }
    save_json(audit, get_paths().reports / "c4_retrieval_eval_audit.json")
    print(
        json.dumps(
            {
                "total": audit["total_questions"],
                "hit_at_3": audit["hit_at_3"],
                "recall_at_3_micro": audit["recall_at_3_micro"],
            },
            indent=2,
        )
    )
    return audit


if __name__ == "__main__":
    main()
